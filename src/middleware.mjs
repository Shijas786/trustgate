// Express middleware: one line turns a route into a paid, identity-gated endpoint.
//   app.get('/api/thing', trustgate({ payTo, priceMicroCcd }), handler)
import { evaluateAgent } from './gate.mjs';
import { X402_VERSION, buildRequirements, decodeHeader, encodeHeader, getFacilitator } from './payments.mjs';
import { explorerTx } from './chain.mjs';

const day = () => new Date().toISOString().slice(0, 10);

export function trustgate({ payTo, priceMicroCcd, description, policy = {}, onDecision = () => {}, deps = {} }) {
  const spend = new Map(); // `${day}:${badge}` -> µCCD settled
  const inFlight = new Set(); // one settlement per badge at a time

  return async function trustgateMiddleware(req, res, next) {
    const started = Date.now();
    const badge = req.get('x-agent-badge') || null;
    const requirements = await buildRequirements({ payTo, amountMicroCcd: priceMicroCcd });
    const resource = { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`, description, mimeType: 'application/json' };
    const paymentPayload = decodeHeader(req.get('payment-signature') ?? req.get('x-payment'));

    if (!paymentPayload) {
      const body = {
        x402Version: X402_VERSION,
        error: 'Payment required. Present a Concordium Badge and an x402 payment signed by the badge\'s agent wallet.',
        resource,
        accepts: [requirements],
        extensions: { trustgate: { badgeHeader: 'X-Agent-Badge', registry: 'CIS-8004', network: 'testnet', checks: ['registered', 'active', 'card_integrity', 'badge_in_card', 'payer_is_agent_wallet', 'within_daily_cap'] } },
      };
      res.set('PAYMENT-REQUIRED', encodeHeader(body));
      return res.status(402).json(body);
    }

    const record = { at: new Date().toISOString(), path: req.originalUrl, badge, payer: paymentPayload?.payload?.sender ?? null, label: req.get('x-agent-label') || null };
    const deny = (status, reason, extra = {}) => {
      Object.assign(record, { outcome: 'denied', reason, ms: Date.now() - started, ...extra });
      onDecision(record);
      return res.status(status).json({ error: 'trustgate_denied', reason, checks: record.checks ?? [], charged: false, ...extra });
    };

    // 1. The facilitator proves the payer signed this exact transfer (signature vs on-chain credentials).
    const facilitator = deps.facilitator ?? getFacilitator();
    const payload = { ...paymentPayload, accepted: requirements };
    const verified = await facilitator.verify(payload, requirements);
    if (!verified.isValid) return deny(402, 'invalid_payment', { detail: verified.invalidReason });
    record.payer = verified.payer;

    // 2. Trust checks against the Agent Registry. Nothing has been charged yet.
    const key = `${day()}:${badge}`;
    const verdict = await evaluateAgent({
      badge,
      payer: verified.payer,
      policy: { ...policy, priceMicroCcd, spentToday: spend.get(key) ?? 0n },
      registry: deps.registry,
      fetchCard: deps.fetchCard,
    });
    record.checks = verdict.checks;
    record.agent = verdict.agent && { token_id: verdict.agent.token_id, owner: verdict.agent.owner_account, uri: verdict.agent.agent_uri };
    if (!verdict.allow) return deny(403, verdict.reason);
    if (inFlight.has(badge)) return deny(429, 'settlement_in_progress');

    // 3. Only a trusted agent reaches settlement: sponsored transfer, finalized on Concordium.
    inFlight.add(badge);
    let settled;
    try {
      settled = await facilitator.settle(payload, requirements);
    } finally {
      inFlight.delete(badge);
    }
    if (!settled.success) return deny(402, 'settlement_failed', { detail: settled.errorReason });
    spend.set(key, BigInt(spend.get(key) ?? 0n) + BigInt(priceMicroCcd));

    const receipt = { transaction: settled.transaction, explorer: explorerTx(settled.transaction), network: settled.network, payer: settled.payer, payTo, amountMicroCcd: String(priceMicroCcd), sponsor: requirements.extra?.feePayer };
    Object.assign(record, { outcome: 'allowed', receipt, ms: Date.now() - started });
    onDecision(record);
    res.set('PAYMENT-RESPONSE', encodeHeader(settled));
    req.trustgate = { agent: verdict.agent, checks: verdict.checks, receipt };
    next();
  };
}
