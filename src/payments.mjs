// x402 on Concordium: payment requirements, verification and sponsored settlement.
import { ExactConcordiumScheme as ServerScheme } from '@x402/concordium/exact/server';
import { ExactConcordiumScheme as FacilitatorScheme } from '@x402/concordium/exact/facilitator';
import { CONCORDIUM_TESTNET_CAIP2, getConcordiumGrpcUrl, parseGrpcUrl, toConcordiumFacilitatorSigner } from '@x402/concordium';

export const NETWORK = CONCORDIUM_TESTNET_CAIP2;
export const X402_VERSION = 2;
const server = new ServerScheme();
let facilitator;

/** In-process facilitator: it sponsors the fee, so the buying agent needs no gas logic. */
export function getFacilitator() {
  if (!facilitator) {
    const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(NETWORK));
    const signer = toConcordiumFacilitatorSigner(process.env.SPONSOR_ADDRESS, process.env.SPONSOR_KEY, { host, port, useTls: true });
    facilitator = new FacilitatorScheme({ signer });
  }
  return facilitator;
}

export async function buildRequirements({ payTo, amountMicroCcd }) {
  const price = await server.parsePrice({ amount: String(amountMicroCcd), asset: 'CCD' }, NETWORK);
  const base = { scheme: 'exact', network: NETWORK, payTo, amount: price.amount, asset: price.asset, maxTimeoutSeconds: 120, extra: price.extra ?? {} };
  const f = getFacilitator();
  return server.enhancePaymentRequirements(base, { x402Version: X402_VERSION, scheme: 'exact', network: NETWORK, extra: f.getExtra(NETWORK) }, []);
}

export const encodeHeader = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
export function decodeHeader(value) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}
