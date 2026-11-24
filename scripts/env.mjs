// Step 3: derive signing keys for the demo accounts and write .env (never committed).
import { ConcordiumHdWallet } from '@concordium/web-sdk';
import fs from 'fs';
const st = JSON.parse(fs.readFileSync('.secrets/wallet.json'));
const w = ConcordiumHdWallet.fromSeedPhrase(st.seedPhrase, 'Testnet');
let out = '';
for (const [n, a] of Object.entries(st.accounts)) {
  out += `${n.toUpperCase()}_ADDRESS=${a.address}\n${n.toUpperCase()}_KEY=${w.getAccountSigningKey(st.ip, st.identityIndex, a.credNumber).toString('hex')}\n`;
}
fs.writeFileSync('.env', out);
