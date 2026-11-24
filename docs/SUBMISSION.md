# TrustGate: submission write-up

**Pitch:** KYC for AI agents, at the paywall.

| Encode field | Value |
|---|---|
| Project name | TrustGate |
| Public repo | https://github.com/Shijas786/trustgate |
| Live demo | (Render URL, once deployed) |
| Demo video | 60 s screen recording: free badge check, trusted purchase, four refusals |
| CCDExplorer | Agent registration and gated purchase links below |
| Description | The sections below, from "What we built" to "Path to production" |

**One line:** Know-Your-Agent for paid APIs. TrustGate checks an AI agent's Concordium Badge in the on-chain Agent Registry before its x402 payment is settled, so sellers only serve accountable agents and refused agents are never charged.

## What we built

An Express middleware (`trustgate()`), a buying-agent client, and a demo service with a live dashboard. The demo sells a Know-Your-Agent due-diligence report for 0.25 CCD per call. Five agents try to buy it; one is admitted and pays on Concordium testnet, four are refused for four different on-chain reasons.

## How it works

1. The API answers `402` with x402 payment requirements and asks for a badge.
2. The agent signs a sponsored CCD transfer and retries with its badge.
3. The facilitator verifies the signature against the payer's on-chain credentials.
4. TrustGate reads the CIS-8004 registry: registered, Active, Agent Card hash equals the on-chain anchor, card carries the badge and owner, and the payer is the agent wallet bound to the badge. Operator policy adds a per-agent daily cap and owner blocklist.
5. Only then is the payment sponsored, finalized, and the data returned with a receipt.

Binding the payment signer to the badge's agent wallet is the key idea: identity and payment are proven by the same signature, so a copied badge is worthless and no extra login step is needed.

## Concordium components

Agent Registry (CIS-8004) on testnet `<12802,0>`, Verified by Concordium badge, hosted Agent Registry MCP server (all reads and all sign-ready payloads), A2A Agent Cards with the badge extension, x402 payments via `@x402/concordium`, sponsored transactions, and identity-backed owner accounts.

## CCDExplorer

- Agent registration: https://ccdexplorer.io/testnet/transaction/3fc95e18d3b55e8f726086dab0eb7571b6c177f8fdbed86fcb8be36e58920eef
- Revocation: https://ccdexplorer.io/testnet/transaction/eea6835ad8ae1878152cd74146bbdeb8ec76aa94547bf1d6d5337401f3a57907
- Sponsored x402 payment: https://ccdexplorer.io/testnet/transaction/3e8f89876503d0b2f34f9a256f3baaf06b54928950a88cb1382dd3fd1762c80b
- Gated purchase through TrustGate: https://ccdexplorer.io/testnet/transaction/86a20dd8a7a8c22f3d3304abc804f27881d43b2a470ac305844bb18b521a2b0a
- Free badge check and gated purchase from the demo film: https://ccdexplorer.io/testnet/transaction/5b90370fe639516a07609a0f572894f6c2cb0f16bab0e47648cb32421ff26ccc
- Operator account: https://ccdexplorer.io/testnet/account/4XC9TBAXSJN174Jj74iBVotS68oqRGPVBM3YzsghzHAD5rasBc

## Path to production

Mainnet is a configuration change (registry `<10082,0>`, mainnet gRPC, mainnet x402 network id) and payments move to a PLT stablecoin, already supported by `@x402/concordium`. The product is an npm middleware plus a hosted gateway for API sellers, priced per verified call. Next: Verify & Access zero-knowledge proofs of owner attributes per route, CIS-8 key bindings for cross-chain agents, and reputation built from settled-payment history. First users are data and inference API sellers that cannot serve anonymous buyers.
