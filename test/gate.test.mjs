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

test('card urls must be public https', async () => {
  const { assertPublicUrl } = await import('../src/gate.mjs');
  const to = (address) => async () => [{ address }];
  await assert.rejects(assertPublicUrl('http://example.com/card.json', to('93.184.216.34')));
  await assert.rejects(assertPublicUrl('https://127.0.0.1/card.json'));
  await assert.rejects(assertPublicUrl('https://[::1]/card.json'));
  await assert.rejects(assertPublicUrl('https://internal.example/card.json', to('10.0.0.5')));
  await assert.rejects(assertPublicUrl('https://metadata.example/card.json', to('169.254.169.254')));
  await assert.rejects(assertPublicUrl('https://mapped.example/card.json', to('::ffff:192.168.1.1')));
  await assertPublicUrl('https://example.com/card.json', to('93.184.216.34'));
});

test('a submitted but unconfirmed settlement is not reported as uncharged', async () => {
  const { trustgate } = await import('../src/middleware.mjs');
  const { encodeHeader } = await import('../src/payments.mjs');
  const body = Buffer.from(JSON.stringify({ capabilities: { extensions: [{ uri: 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1', params: { tokenAddress: 'B1', owner: { account: 'OWNER' } } }] } }));
  const mw = trustgate({
    payTo: '4XC9TBAXSJN174Jj74iBVotS68oqRGPVBM3YzsghzHAD5rasBc', priceMicroCcd: 1n,
    deps: {
      buildRequirements: async () => ({ extra: {} }),
      facilitator: { verify: async () => ({ isValid: true, payer: 'OWNER' }), settle: async () => ({ success: false, errorReason: 'timeout', transaction: 'abc' }) },
      registry: async () => ({ token_id: 1, owner_account: 'OWNER', agent_wallet: 'OWNER', status: 'Active', agent_uri: 'https://x/card.json', metadata_hash_hex: createHash('sha256').update(body).digest('hex') }),
      fetchCard: async () => ({ status: 200, body }),
    },
  });
  const headers = { 'x-agent-badge': 'B1', 'payment-signature': encodeHeader({ x402Version: 2, payload: { sender: 'OWNER' } }), host: 'localhost' };
  const out = {};
  const res = { set() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await mw({ get: (h) => headers[h.toLowerCase()], protocol: 'http', originalUrl: '/x' }, res, () => { out.next = true; });
  assert.equal(out.status, 502);
  assert.equal(out.body.charged, 'unconfirmed');
  assert.equal(out.body.transaction, 'abc');
  assert.equal(out.next, undefined);
});
