// Step 2: deploy credentials (accounts) from the issued identity and request testnet CCD.
import { ConcordiumHdWallet, createCredentialPayloadNoSeed, signCredentialTransaction, serializeCredentialDeploymentPayload, getAccountAddress, TransactionExpiry, AttributesKeys } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import fs from 'fs';
const f = '.secrets/wallet.json';
const st = JSON.parse(fs.readFileSync(f));
const client = new ConcordiumGRPCNodeClient('grpc.testnet.concordium.com', 20000, credentials.createSsl());
const global = await client.getCryptographicParameters();
const WP = 'https://wallet-proxy.testnet.concordium.com';
const idp = (await (await fetch(WP + '/v1/ip_info')).json()).find((i) => i.ipInfo.ipIdentity === st.ip);
const idObject = (await (await fetch(fs.readFileSync('.secrets/code_uri.txt', 'utf8').trim())).json()).token.identityObject.value;
const w = ConcordiumHdWallet.fromSeedPhrase(st.seedPhrase, 'Testnet');
st.accounts ??= {};
for (const [name, credNumber] of Object.entries({ operator: 0, agent: 1, rogue: 2, sponsor: 3 })) {
  if (st.accounts[name]) continue;
  const attributeRandomness = Object.fromEntries(Object.keys(AttributesKeys).filter((k) => isNaN(Number(k))).map((k) => [k, w.getAttributeCommitmentRandomness(st.ip, st.identityIndex, credNumber, AttributesKeys[k]).toString('hex')]));
  const expiry = TransactionExpiry.fromDate(new Date(Date.now() + 360000));
  const payload = createCredentialPayloadNoSeed({
    revealedAttributes: [], idObject, globalContext: global, credNumber, ipInfo: idp.ipInfo, arsInfos: idp.arsInfos, attributeRandomness,
    credentialPublicKeys: { keys: { 0: { schemeId: 'Ed25519', verifyKey: w.getAccountPublicKey(st.ip, st.identityIndex, credNumber).toString('hex') } }, threshold: 1 },
    idCredSec: w.getIdCredSec(st.ip, st.identityIndex).toString('hex'), prfKey: w.getPrfKey(st.ip, st.identityIndex).toString('hex'),
    sigRetrievelRandomness: w.getSignatureBlindingRandomness(st.ip, st.identityIndex).toString('hex'),
  }, expiry);
  const signingKey = w.getAccountSigningKey(st.ip, st.identityIndex, credNumber).toString('hex');
  const sig = await signCredentialTransaction(payload, signingKey);
  const hash = await client.sendCredentialDeploymentTransaction(serializeCredentialDeploymentPayload([sig], payload), expiry);
  await client.waitForTransactionFinalization(hash);
  const address = getAccountAddress(payload.unsignedCdi.credId).address;
  st.accounts[name] = { address, credNumber };
  fs.writeFileSync(f, JSON.stringify(st, null, 2));
  const d = await fetch(`${WP}/v0/testnetGTUDrop/${address}`, { method: 'PUT' });
  console.log(name, address, 'drop', d.status, await d.text());
}
