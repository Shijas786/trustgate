// Step 1: create a seed phrase + identity request for the Concordium testnet IDP; prints the URL to open.
import { ConcordiumHdWallet, createIdentityRequestWithKeys } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import { generateMnemonic } from 'bip39';
import fs from 'fs';
const f = '.secrets/wallet.json';
fs.mkdirSync('.secrets', { recursive: true, mode: 0o700 });
const st = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : { seedPhrase: generateMnemonic(256), ip: 0, identityIndex: 0 };
fs.writeFileSync(f, JSON.stringify(st, null, 2), { mode: 0o600 });
fs.chmodSync('.secrets', 0o700);
fs.chmodSync(f, 0o600);
const client = new ConcordiumGRPCNodeClient('grpc.testnet.concordium.com', 20000, credentials.createSsl());
const global = await client.getCryptographicParameters();
const idps = await (await fetch('https://wallet-proxy.testnet.concordium.com/v1/ip_info')).json();
const idp = idps.find((i) => i.ipInfo.ipIdentity === st.ip);
const w = ConcordiumHdWallet.fromSeedPhrase(st.seedPhrase, 'Testnet');
const req = createIdentityRequestWithKeys({
  arsInfos: idp.arsInfos, arThreshold: Math.min(Object.keys(idp.arsInfos).length - 1, 255), ipInfo: idp.ipInfo, globalContext: global,
  idCredSec: w.getIdCredSec(st.ip, st.identityIndex).toString('hex'), prfKey: w.getPrfKey(st.ip, st.identityIndex).toString('hex'),
  blindingRandomness: w.getSignatureBlindingRandomness(st.ip, st.identityIndex).toString('hex'),
});
const p = new URLSearchParams({ scope: 'identity', response_type: 'code', redirect_uri: 'http://localhost:4173/confirm-identity', state: JSON.stringify({ idObjectRequest: req }) });
const url = `${idp.metadata.issuanceStart}?${p}`;
fs.writeFileSync('.secrets/id-url.txt', url);
const r = await fetch(url, { redirect: 'manual' });
console.log('Open this URL and complete the test identity verification:\n' + r.headers.get('location'));
console.log('\nThe browser is then redirected to http://localhost:4173/confirm-identity#code_uri=<URL> (the page itself does not load).');
console.log('Save that <URL> to .secrets/code_uri.txt, then run scripts/accounts.mjs.');
