// Concordium testnet helpers: gRPC client and sign-and-send for MCP-built contract updates.
import { AccountAddress, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName, Transaction, TransactionExpiry, buildBasicAccountSigner } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';

export const client = new ConcordiumGRPCNodeClient(process.env.CCD_GRPC_HOST || 'grpc.testnet.concordium.com', 20000, credentials.createSsl());
export const explorerTx = (hash) => `https://ccdexplorer.io/testnet/transaction/${hash}`;
export const explorerAccount = (a) => `https://ccdexplorer.io/testnet/account/${a}`;

/** Signs and submits a sign-ready payload returned by the Agent Registry MCP `build_*` tools. */
export async function sendBuilt(built, senderAddress, signingKey) {
  const sender = AccountAddress.fromBase58(senderAddress);
  const { nonce } = await client.getNextAccountNonce(sender);
  const tx = Transaction.updateContract(
    {
      amount: CcdAmount.zero(),
      address: ContractAddress.create(built.contract_address.index, built.contract_address.subindex),
      receiveName: ReceiveName.fromString(built.receive_name),
      message: Parameter.fromHexString(built.parameter_hex),
    },
    Energy.create(built.suggested_energy)
  )
    .addMetadata({ sender, nonce, expiry: TransactionExpiry.futureMinutes(5) })
    .build();
  const signed = await Transaction.signAndFinalize(tx, buildBasicAccountSigner(signingKey));
  const hash = await client.sendTransaction(signed);
  const outcome = await client.waitForTransactionFinalization(hash);
  const summary = outcome.summary;
  if (summary.type === 'accountTransaction' && summary.transactionType === 'failed') {
    throw new Error(`${built.receive_name} rejected: ${JSON.stringify(summary.rejectReason)}`);
  }
  return hash.toString();
}
