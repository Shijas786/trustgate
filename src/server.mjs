// TrustGate demo service: a paid "Know Your Agent" report API, gated by TrustGate itself.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustgate } from './middleware.mjs';
import { registry } from './registry.mjs';
import { evaluateAgent } from './gate.mjs';
import { buyWithBadge } from './agent-client.mjs';
import { explorerAccount, explorerTx } from './chain.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const PORT = Number(env.PORT || 8787);
const PRICE = BigInt(env.PRICE_MICRO_CCD || 250000); // 0.25 CCD per report
const DAILY_CAP = BigInt(env.DAILY_CAP_MICRO_CCD || 5000000); // 5 CCD per agent per day
const agents = JSON.parse(fs.readFileSync(path.join(root, 'cards/agents.json'), 'utf8'));

const logFile = path.join(root, env.DECISION_LOG || 'data/decisions.json');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
let decisions = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];
const onDecision = (d) => {
  decisions.unshift(d);
  decisions = decisions.slice(0, 200);
  fs.writeFileSync(logFile, JSON.stringify(decisions));
};

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(root, 'public')));
app.use('/cards', express.static(path.join(root, 'cards')));

// The paid product: a due-diligence report on any registered agent, built from on-chain data.
app.get(
  '/api/report/:badge',
  // Refuse before any payment if the report cannot be produced.
  async (req, res, next) => {
    try {
      const subject = await registry('agent_by_token_address', { token_address: req.params.badge });
      if (!subject?.owner_account) return res.status(404).json({ error: 'unknown_subject', charged: false });
      next();
    } catch {
      res.status(404).json({ error: 'unknown_subject', charged: false });
    }
  },
  trustgate({ payTo: env.OPERATOR_ADDRESS, priceMicroCcd: PRICE, description: 'Know-Your-Agent due-diligence report', policy: { dailyCapMicroCcd: DAILY_CAP }, onDecision }),
  async (req, res) => {
    const subject = req.params.badge;
    const verdict = await evaluateAgent({ badge: subject, payer: null });
    const history = verdict.agent ? await registry('agent_history', { token_id: Number(verdict.agent.token_id) }).catch(() => null) : null;
    const checks = verdict.checks.filter((c) => c.id !== 'payer_is_agent_wallet');
    res.json({
      report: {
        subject,
        agent: verdict.agent,
        checks,
        score: Math.round((100 * checks.filter((c) => c.pass).length) / checks.length),
        events: history?.events?.map((e) => ({ event: e.event_name, tx: e.tx_hash, at: e.timestamp })) ?? [],
      },
      buyer: { token_id: req.trustgate.agent.token_id, owner: req.trustgate.agent.owner_account },
      receipt: req.trustgate.receipt,
    });
  }
);

// Free pre-flight: lets an agent (or a human) see how the gate would judge a badge.
app.get('/api/check/:badge', async (req, res) => {
  const verdict = await evaluateAgent({ badge: req.params.badge, payer: req.query.payer || null });
  res.json(verdict);
});

app.get('/api/state', (_req, res) => {
  const paid = decisions.filter((d) => d.outcome === 'allowed');
  res.json({
    network: 'Concordium testnet',
    priceMicroCcd: String(PRICE),
    dailyCapMicroCcd: String(DAILY_CAP),
    accounts: Object.fromEntries(['operator', 'sponsor', 'agent', 'rogue'].map((n) => [n, { address: env[`${n.toUpperCase()}_ADDRESS`], explorer: explorerAccount(env[`${n.toUpperCase()}_ADDRESS`]) }])),
    agents: Object.fromEntries(Object.entries(agents).map(([id, a]) => [id, { name: a.name, token_id: a.token_id, badge: a.token_address, owner: a.owner, card: a.agent_uri, txs: Object.fromEntries(Object.entries(a.txs).map(([k, h]) => [k, explorerTx(h)])) }])),
    stats: { allowed: paid.length, denied: decisions.length - paid.length, earnedMicroCcd: String(paid.reduce((s, d) => s + BigInt(d.receipt.amountMicroCcd), 0n)) },
    decisions: decisions.slice(0, 40),
  });
});

// Demo agents the dashboard can launch. Each one makes a real HTTP call and, if admitted, a real testnet payment.
const scenarios = {
  trusted: { label: 'Atlas (registered, active)', badge: agents.atlas.token_address, who: 'AGENT' },
  unregistered: { label: 'Anonymous bot (no badge)', badge: null, who: 'ROGUE' },
  stolen: { label: 'Impostor (presents Atlas\'s badge, pays from another wallet)', badge: agents.atlas.token_address, who: 'ROGUE' },
  revoked: { label: 'Ghost (badge revoked on-chain)', badge: agents.ghost.token_address, who: 'ROGUE' },
  tampered: { label: 'Mirage (card edited after anchoring)', badge: agents.mirage.token_address, who: 'ROGUE' },
};
let busy = false;
app.post('/api/demo/:scenario', async (req, res) => {
  const s = scenarios[req.params.scenario];
  if (!s) return res.status(404).json({ error: 'unknown scenario' });
  if (busy) return res.status(429).json({ error: 'A demo agent is already running, try again in a few seconds.' });
  busy = true;
  try {
    const subject = req.body?.subject || agents.atlas.token_address;
    const out = await buyWithBadge({ url: `http://127.0.0.1:${PORT}/api/report/${encodeURIComponent(subject)}`, badge: s.badge, address: env[`${s.who}_ADDRESS`], signingKey: env[`${s.who}_KEY`], label: s.label });
    res.json({ scenario: req.params.scenario, label: s.label, ...out });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  } finally {
    busy = false;
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', detail: String(err.message).slice(0, 200) });
});

app.listen(PORT, () => console.log(`TrustGate listening on :${PORT}`));
