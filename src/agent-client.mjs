// A buying agent: hits a TrustGate endpoint, reads the 402, pays with a sponsored transaction, retries.
import { ExactConcordiumScheme as ClientScheme } from '@x402/concordium/exact/client';
import { AccountAddress, buildBasicAccountSigner } from '@concordium/web-sdk';

export async function buyWithBadge({ url, badge, address, signingKey, label }) {
  const steps = [];
  const first = await fetch(url);
  if (first.status !== 402) return { status: first.status, body: await first.json(), steps };
  const offer = await first.json();
  const requirements = offer.accepts[0];
  steps.push({ step: '402 Payment Required', detail: `${requirements.amount} µCCD to ${requirements.payTo}, fee sponsored by ${requirements.extra?.feePayer}` });

  const scheme = new ClientScheme({ accountAddress: AccountAddress.fromBase58(address), signer: buildBasicAccountSigner(signingKey) });
  const payment = await scheme.createPaymentPayload(offer.x402Version, requirements);
  steps.push({ step: 'Signed sponsored transfer', detail: `sender ${address}` });

  const headers = { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payment)).toString('base64') };
  if (badge) headers['X-Agent-Badge'] = badge;
  if (label) headers['X-Agent-Label'] = label;
  const second = await fetch(url, { headers });
  const body = await second.json();
  steps.push({ step: second.ok ? 'Access granted' : 'Access denied', detail: second.ok ? body.receipt?.transaction : body.reason });
  return { status: second.status, body, steps };
}
