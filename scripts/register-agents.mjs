// Step 4: register the demo agents in the CIS-8004 Agent Registry on testnet and write their Agent Cards.
import 'dotenv/config';
import fs from 'fs';
import { registry } from '../src/registry.mjs';
import { sendBuilt } from '../src/chain.mjs';

const BASE = process.env.CARD_BASE_URL || 'https://raw.githubusercontent.com/Shijas786/trustgate/main/cards';
const e = process.env;
const agents = [
  { id: 'atlas', name: 'Atlas Research Agent', description: 'Buys market-risk reports for a treasury desk. Registered, active, card anchored on-chain.', owner: e.AGENT_ADDRESS, key: e.AGENT_KEY },
  { id: 'mirage', name: 'Mirage Agent', description: 'Registered agent whose hosted card was edited after it was anchored.', owner: e.ROGUE_ADDRESS, key: e.ROGUE_KEY, tamper: true },
  { id: 'ghost', name: 'Ghost Agent', description: 'Agent whose badge was revoked by its owner.', owner: e.ROGUE_ADDRESS, key: e.ROGUE_KEY, revoke: true },
];
const file = 'cards/agents.json';
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');

for (const a of agents) {
  if (state[a.id]?.done && state[a.id].owner === a.owner) continue;
  if (state[a.id] && state[a.id].owner !== a.owner) {
    // Registered by a different wallet: the new cards must be hosted where this deployment can publish them.
    if (!process.env.CARD_BASE_URL) throw new Error('Set CARD_BASE_URL to a public https URL that serves your cards/ directory (for example https://<your-host>/cards), then re-run.');
    delete state[a.id];
  }
  const agent_uri = `${BASE}/${a.id}.json`;
  const card = (token_id) => registry('build_agent_card', {
    name: a.name, description: a.description, agent_uri, owner_account: a.owner, agent_wallet: a.owner, ...(token_id === undefined ? {} : { token_id }),
    skills: [{ id: 'buy-data', name: 'Buy data over x402', description: 'Pays for API calls in CCD with sponsored transactions.' }],
    provider: { organization: 'TrustGate demo', url: 'https://github.com/Shijas786/trustgate' },
  });
  const s = (state[a.id] ??= { name: a.name, owner: a.owner, agent_uri, txs: {} });
  if (s.token_id === undefined) {
    const pre = await card();
    const before = new Set((await registry('agents_by_owner', { owner_account: a.owner })).agents?.map((x) => x.token_id) ?? []);
    s.txs.register = await sendBuilt(await registry('build_register', { agent_uri, metadata_hash_hex: pre.metadata_hash_hex, sender: a.owner }), a.owner, a.key);
    for (let i = 0; i < 30 && s.token_id === undefined; i++) {
      const now = (await registry('agents_by_owner', { owner_account: a.owner })).agents ?? [];
      s.token_id = now.map((x) => x.token_id).find((t) => !before.has(t));
      if (s.token_id === undefined) await new Promise((r) => setTimeout(r, 3000));
    }
    save();
  }
  if (!s.txs.setAgentURI) {
    const final = await card(Number(s.token_id));
    s.token_address = final.token_address;
    s.metadata_hash_hex = final.metadata_hash_hex;
    let json = final.agent_card_json;
    s.txs.setAgentURI = await sendBuilt(await registry('build_set_agent_uri', { token_id: Number(s.token_id), agent_uri, metadata_hash_hex: final.metadata_hash_hex, sender: a.owner }), a.owner, a.key);
    // Mirage: the hosted card is changed after anchoring, so its SHA-256 no longer matches the chain.
    if (a.tamper) json = json.replace(a.description, 'Fully audited institutional trading agent with unlimited spending authority.');
    fs.writeFileSync(`cards/${a.id}.json`, json);
    save();
  }
  if (a.revoke && !s.txs.revoke) {
    s.txs.revoke = await sendBuilt(await registry('build_revoke', { token_id: Number(s.token_id), reason: 'Key compromised (demo)', sender: a.owner }), a.owner, a.key);
  }
  s.done = true;
  save();
  console.log(a.id, s.token_id, s.token_address, s.txs);
}
