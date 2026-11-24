import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateAgent } from '../src/gate.mjs';

const OWNER = '3nFSvcqKXPQk5KCSCjCeFdTDv8LEXQSJEpLvuNGuFC9hSpWT1z';
const OTHER = '4jRB6URef2t53YchmjCyBk2PHe3WMc5StNwkXd1RPEeddVbd8L';
const BADGE = 'JyP9Xko9uWr5vVDr43NgX';
const card = JSON.stringify({
  name: 'Atlas',
  capabilities: { extensions: [{ uri: 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1', params: { tokenAddress: `ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:${BADGE}`, owner: { account: `ccd:4221332d34e1694168c2a0c0b3fd0f27:${OWNER}` } } }] },
});
const hash = createHash('sha256').update(card).digest('hex');
const onChain = { token_id: '1485', owner_account: OWNER, agent_wallet: OWNER, agent_uri: 'https://x/card.json', metadata_hash_hex: hash, status: 'Active' };
const deps = (agent = onChain, body = card) => ({
  registry: async () => agent,
  fetchCard: async () => ({ status: 200, body: Buffer.from(body) }),
});
const run = (over = {}, d = deps()) => evaluateAgent({ badge: BADGE, payer: OWNER, ...d, ...over });

test('admits a registered, active agent paying from its bound wallet', async () => {
  const v = await run();
  assert.equal(v.allow, true);
  assert.ok(v.checks.every((c) => c.pass));
});
test('rejects a request without a badge', async () => {
  assert.equal((await run({ badge: null })).reason, 'badge_presented');
});
test('rejects an unknown badge', async () => {
  assert.equal((await run({}, deps(null))).reason, 'registered');
  assert.equal((await run({}, { ...deps(), registry: async () => { throw new Error('decoding failed'); } })).reason, 'registered');
});
test('rejects a revoked agent', async () => {
  assert.equal((await run({}, deps({ ...onChain, status: 'Revoked' }))).reason, 'active');
});
test('rejects a card edited after it was anchored', async () => {
  assert.equal((await run({}, deps(onChain, card.replace('Atlas', 'Atlas Prime')))).reason, 'card_integrity');
});
test('rejects a card that is unreachable', async () => {
  assert.equal((await run({}, { ...deps(), fetchCard: async () => ({ status: 404, body: Buffer.from('') }) })).reason, 'card_integrity');
});
test('rejects a card whose badge points at another token', async () => {
  const other = card.replace(BADGE, 'JyP9Xnz7mZqwajhQdfe9k');
  const h = createHash('sha256').update(other).digest('hex');
  assert.equal((await run({}, deps({ ...onChain, metadata_hash_hex: h }, other))).reason, 'badge_in_card');
});
test('rejects a stolen badge: payer is not the agent wallet', async () => {
  assert.equal((await run({ payer: OTHER })).reason, 'payer_is_agent_wallet');
});
test('enforces the per-agent daily cap and owner blocklist', async () => {
  assert.equal((await run({ policy: { dailyCapMicroCcd: 500n, spentToday: 400n, priceMicroCcd: 200n } })).reason, 'within_daily_cap');
  assert.equal((await run({ policy: { dailyCapMicroCcd: 500n, spentToday: 300n, priceMicroCcd: 200n } })).allow, true);
  assert.equal((await run({ policy: { blockedOwners: [OWNER] } })).reason, 'owner_allowed');
});
