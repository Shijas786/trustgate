// TrustGate policy engine: decides whether an agent may buy, from on-chain facts only.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { registry as defaultRegistry } from './registry.mjs';

const BADGE_EXT = 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const tail = (caip) => (typeof caip === 'string' ? caip.split(/[:/]/).pop() : caip);

const MAX_CARD_BYTES = 256 * 1024;

// Card URLs are chosen by agent owners, so only public https hosts are fetched and redirects are not followed.
export async function assertPublicUrl(url, resolve = (h) => lookup(h, { all: true })) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('card url must be https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error('card url resolves to a non-public address');
}

function isPrivate(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivate(mapped[1]);
  return v === '::' || v === '::1' || v.startsWith('::ffff:') || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

async function defaultFetchCard(url) {
  await assertPublicUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_CARD_BYTES) throw new Error('card too large');
  return { status: res.status, body };
}

/**
 * Runs every trust check for a badge. `payer` is the account that signed the x402 payment
 * (already signature-verified against on-chain credentials by the facilitator).
 * Returns { allow, reason, checks[], agent } and never throws for a bad agent.
 */
export async function evaluateAgent({ badge, payer, policy = {}, registry = defaultRegistry, fetchCard = defaultFetchCard }) {
  const checks = [];
  const add = (id, label, pass, detail) => (checks.push({ id, label, pass, detail }), pass);
  const done = (agent) => {
    const failed = checks.find((c) => !c.pass);
    return { allow: !failed, reason: failed?.id ?? null, checks, agent: agent ?? null };
  };

  if (!add('badge_presented', 'Agent presented a Concordium Badge', Boolean(badge), badge || 'no X-Agent-Badge header')) return done();

  let agent;
  try {
    agent = await registry('agent_by_token_address', { token_address: badge });
  } catch (err) {
    agent = null;
    add('registered', 'Badge resolves in the CIS-8004 Agent Registry', false, /Base58Check/.test(err.message) ? 'not a valid badge' : String(err.message).slice(0, 160));
    return done();
  }
  if (!add('registered', 'Badge resolves in the CIS-8004 Agent Registry', Boolean(agent?.owner_account), agent?.owner_account ? `token #${agent.token_id}, owner ${agent.owner_account}` : 'unknown token address')) return done();

  add('active', 'Agent status is Active (not revoked)', agent.status === 'Active', agent.status);

  let card = null;
  let cardHash = null;
  try {
    const got = await fetchCard(agent.agent_uri);
    if (got.status === 200) {
      cardHash = sha256(got.body);
      card = JSON.parse(got.body.toString('utf8'));
    }
  } catch {
    /* treated as a failed integrity check below */
  }
  add('card_integrity', 'Agent Card SHA-256 matches the on-chain anchor', cardHash !== null && cardHash === agent.metadata_hash_hex,
    cardHash ? `card ${cardHash.slice(0, 12)}… vs chain ${String(agent.metadata_hash_hex).slice(0, 12)}…` : `card not retrievable at ${agent.agent_uri}`);

  const ext = card?.capabilities?.extensions?.find((x) => x.uri === BADGE_EXT)?.params;
  add('badge_in_card', 'Card carries this badge and names the on-chain owner',
    Boolean(ext) && tail(ext.tokenAddress) === badge && tail(ext.owner?.account) === agent.owner_account,
    ext ? `card badge ${tail(ext.tokenAddress)}` : 'no Concordium Badge extension in card');

  const wallet = agent.agent_wallet ?? null;
  add('payer_is_agent_wallet', 'Payment is signed by the agent wallet bound to the badge', Boolean(payer) && payer === wallet,
    payer ? `payer ${payer.slice(0, 10)}… vs agent wallet ${String(wallet).slice(0, 10)}…` : 'no payment presented');

  if (policy.blockedOwners?.length) {
    add('owner_allowed', 'Owner account is not on the operator blocklist', !policy.blockedOwners.includes(agent.owner_account), agent.owner_account);
  }
  if (policy.dailyCapMicroCcd !== undefined) {
    const spent = BigInt(policy.spentToday ?? 0);
    const next = spent + BigInt(policy.priceMicroCcd ?? 0);
    add('within_daily_cap', 'Purchase stays within the per-agent daily cap', next <= BigInt(policy.dailyCapMicroCcd), `${next} of ${policy.dailyCapMicroCcd} µCCD`);
  }
  return done(agent);
}
