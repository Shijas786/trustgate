# TrustGate

**Know-Your-Agent for paid APIs on Concordium.** One Express middleware that checks an AI agent's on-chain identity before its x402 payment is settled. Trusted agents pay with a sponsored transaction and get the data. Everyone else is refused and never charged.

Built for the Concordium Trusted Agents Hackathon. Runs on Concordium testnet.

## The problem

x402 lets any agent pay for an API call. It does not tell the seller who is paying. A seller of financial data, compute or regulated content cannot serve "whoever has funds": the buyer may be a revoked agent, an impostor replaying someone else's identity, or an agent whose public description was changed after it was vetted.

## What TrustGate does

```js
app.get('/api/report/:id',
  trustgate({ payTo: OPERATOR, priceMicroCcd: 250000n, policy: { dailyCapMicroCcd: 5000000n } }),
  handler);
```

For every request it:

1. Answers `402 Payment Required` with x402 payment requirements and asks for a Concordium Badge (`X-Agent-Badge`).
2. Has the facilitator verify the agent's signed, sponsored CCD transfer against the payer's on-chain account credentials.
3. Reads the **CIS-8004 Agent Registry** through Concordium's hosted Agent Registry MCP server and checks:
   - the badge resolves to a registered agent,
   - its status is `Active` (not revoked),
   - the hosted A2A Agent Card's SHA-256 equals the hash anchored on-chain,
   - the card carries this badge and names the on-chain owner,
   - **the account that signed the payment is the agent wallet bound to the badge** (a stolen badge is useless),
   - the purchase fits the operator's per-agent daily cap and owner blocklist.
4. Only then sponsors and settles the payment (the agent pays no fee), waits for finality, and returns the data with a receipt that links to the transaction.

A refused agent's transaction is never submitted, so it is never charged.

## Concordium components used

| Component | How it is used |
|---|---|
| Agent Registry (CIS-8004) | Demo agents are registered, updated and revoked on testnet contract `<12802,0>`; every request is judged from registry state |
| Verified by Concordium badge | The badge (CIS-2 token address) is the agent's credential in the `X-Agent-Badge` header |
| Agent Registry MCP server | All registry reads and all sign-ready transaction payloads come from `agent-registry-mcp.concordium.com` |
| A2A Agent Card | Cards built with the Concordium badge extension, hash-anchored on-chain, integrity-checked per request |
| x402 payments (`@x402/concordium`) | Exact scheme, CCD, x402 v2 |
| Sponsored transactions | An in-process facilitator sponsors the fee of each settled payment |
| Concordium ID | Every owner account is created from an identity issued by a Concordium identity provider, so each badge traces to an accountable owner |

## On-chain evidence (testnet)

| What | Link |
|---|---|
| Atlas agent registered (token 1485, badge `JyP9Xko9uWr5vVDr43NgX`) | https://ccdexplorer.io/testnet/transaction/3fc95e18d3b55e8f726086dab0eb7571b6c177f8fdbed86fcb8be36e58920eef |
| Atlas card anchored | https://ccdexplorer.io/testnet/transaction/a626875edec028ea7b6d4fff1c3c3912cc14723aa36c24c37014b8810a9c4c58 |
| Ghost agent revoked (token 1487) | https://ccdexplorer.io/testnet/transaction/eea6835ad8ae1878152cd74146bbdeb8ec76aa94547bf1d6d5337401f3a57907 |
| Sponsored x402 payment | https://ccdexplorer.io/testnet/transaction/3e8f89876503d0b2f34f9a256f3baaf06b54928950a88cb1382dd3fd1762c80b |
| Gated purchase by Atlas through TrustGate (0.25 CCD, fee sponsored) | https://ccdexplorer.io/testnet/transaction/86a20dd8a7a8c22f3d3304abc804f27881d43b2a470ac305844bb18b521a2b0a |
| Operator account (receives payments) | https://ccdexplorer.io/testnet/account/4XC9TBAXSJN174Jj74iBVotS68oqRGPVBM3YzsghzHAD5rasBc |

## Demo scenarios

The dashboard launches five agents against the same paid endpoint:

| Agent | Result |
|---|---|
| Atlas: registered, active, pays from its bound wallet | Admitted, pays 0.25 CCD, receives the report |
| Anonymous bot: funded, no badge | Refused |
| Impostor: presents Atlas's badge, pays from another wallet | Refused |
| Ghost: badge revoked on-chain | Refused |
| Mirage: Agent Card edited after anchoring | Refused |

The paid product is itself a Know-Your-Agent report: a due-diligence summary of any registered agent (registry record, checks, score, full on-chain event history).

## Run it

```bash
npm install
node scripts/id-start.mjs        # creates a testnet wallet; open the printed URL, then save the code_uri from the redirect to .secrets/code_uri.txt
node scripts/accounts.mjs        # deploys the accounts and requests test CCD
node scripts/env.mjs             # writes .env
CARD_BASE_URL=https://<your-host>/cards node scripts/register-agents.mjs # registers your own demo agents; host cards/ at that URL (the server serves /cards)
npm start                        # http://localhost:8787
npm test
```

To host it, deploy the included `Dockerfile` (a `render.yaml` blueprint is provided) and set the variables from `.env`.

`GET /api/check/:badge` is a free pre-flight that returns the same verdict the gate would reach.

## Layout

- `src/middleware.mjs` the `trustgate()` middleware
- `src/gate.mjs` policy engine
- `src/payments.mjs` x402 requirements and sponsored settlement
- `src/registry.mjs` Agent Registry MCP client
- `src/agent-client.mjs` a buying agent
- `src/server.mjs`, `public/` demo API and dashboard
- `cards/` hosted Agent Cards (anchored on-chain by hash)

## Path to mainnet

- **Config, not code:** the registry (`<10082,0>` on mainnet), gRPC endpoint and x402 network id are parameters. Payments move from test CCD to a PLT stablecoin, which `@x402/concordium` already supports.
- **Product:** publish `trustgate` as an npm middleware plus a hosted gateway that API sellers put in front of existing endpoints, priced per verified call.
- **Stronger policy:** require Verify & Access zero-knowledge proofs from the owner (jurisdiction, age, not sanctioned) per route, CIS-8 key bindings for agents that also pay from EVM or Solana, and reputation from settled-payment history.
- **Operations:** dedicated facilitator account with spend limits, persistent decision log, indexer-backed cache for registry reads with on-chain fallback.
- **First users:** data and inference API sellers that must not serve anonymous buyers, and agent platforms that want their agents accepted everywhere a badge is recognised.
