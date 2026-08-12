# KeeperHub Execution Proof (M1)

Solvo is a Telegram-native conversational treasury execution agent for the
KeeperHub "The Last Mile" hackathon. M1 proves that Solvo can securely invoke
KeeperHub and produce a real onchain transaction with observable proof —
before any Telegram, database, wallet-UI, policy or agent-orchestration work
begins.

## What M1 proves

```
DEVELOPER TEST INPUT
→ SOLVO SERVER-SIDE KEEPERHUB CLIENT (MCP)
→ KEEPERHUB
→ REAL BASE USDC EXECUTION
→ EXECUTION RESULT + TRANSACTION HASH / PROOF
```

The transaction goes **Solvo → KeeperHub → onchain**. Solvo never constructs
or broadcasts a transaction with a raw RPC client.

## Required KeeperHub setup

1. Sign up at [app.keeperhub.com](https://app.keeperhub.com). A Turnkey wallet
   is provisioned automatically.
2. Confirm a **wallet integration** exists for your organization
   (Wallet Management). Write actions require it. The doctor command reports
   this.
3. Fund the wallet with a small amount of Base ETH (gas) and Base USDC
   (the transfer value). KeeperHub's sponsored-gas allowance covers gas in
   many cases, but the USDC being transferred always comes from the wallet.
4. Create an **Organization API key** (`kh_` prefix):
   Settings → API Keys → Organisation tab → Create New Key. Copy it
   immediately — it is shown only once.

## Environment variables

Server-only. Never use `NEXT_PUBLIC_` for these.

| Variable | Required | Purpose |
|---|---|---|
| `KEEPERHUB_API_KEY` | yes | Organization API key (`kh_…`), used as the MCP Bearer token |
| `KEEPERHUB_MCP_URL` | no | Hosted MCP endpoint (default `https://app.keeperhub.com/mcp`) |
| `KEEPERHUB_USDC_TOKEN_ADDRESS` | no | USDC on Base mainnet (default `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, verified on-chain: symbol USDC, 6 decimals) |

Copy `.env.example` to `.env`. Secrets are never printed by the scripts or
surfaced in output.

## Commands

| Command | What it does | Moves funds? |
|---|---|---|
| `npm test` | Unit tests (node:test) — pure, offline | never |
| `npm run keeperhub:doctor` | Connectivity, auth, wallet and capability check | never |
| `npm run keeperhub:read` | Harmless read-only KeeperHub tool calls | never |
| `npm run keeperhub:transfer-proof -- --to 0x… --amount 0.01 --confirm-real-transfer` | The real proof transfer | yes — after confirmation |

### 1. Doctor

```
npm run keeperhub:doctor
```

Reports, in order:

```
KEEPERHUB CONNECTION     OK
AUTHENTICATION           OK
TOOL EXECUTE_TRANSFER    AVAILABLE
TOOL GET_STATUS          AVAILABLE
WALLET INTEGRATION       CONFIGURED
WALLET ADDRESS           0x12…AB
TARGET NETWORK           BASE / 8453
ASSET                    USDC (Base)
READY FOR WRITE          YES
```

Exit code 0 when ready for a write, 2 otherwise with the exact missing item.
If the wallet is not configured, the doctor stops cleanly and says what to do
in KeeperHub — Solvo does not work around a missing wallet with unrelated
custody code.

### 2. Harmless read

```
npm run keeperhub:read
```

Performs read-only tool invocations (`list_integrations`,
`get_wallet_integration`, `list_action_schemas`, tool listing) to verify
authentication → tool invocation → result parsing before any money is
involved. Nothing is broadcast.

### Wallet discovery

The MCP `get_wallet_integration` tool requires the integration ID. The
adapter discovers it by calling `list_integrations` (no arguments), finds the
`web3` integration, then calls `get_wallet_integration` with the live schema's
`integrationId` field. The wallet address is read from the `walletAddress`
field of the response. The doctor follows this exact flow.

### 3. Real transfer proof

```
npm run keeperhub:transfer-proof -- --to 0x742d…44e --amount 0.01 --task-id proof-2026-08-11 --confirm-real-transfer
```

Hard constraints enforced **before** KeeperHub is called:

- Base mainnet only (`8453`), USDC only. No arbitrary token or network selection.
- Recipient must be a valid EVM address (EIP-55 checksum or all-lowercase);
  the zero address is rejected.
- Amount must be positive, at most 6 decimal places, and at or below the
  **0.10 USDC hard cap**. Anything above fails locally before any API call.
- `--confirm-real-transfer` is required. Without it the script prints the
  full warning block and refuses to broadcast.

The script always:

1. prints the warning block (target, asset, recipient, amount, idempotency);
2. refuses to broadcast without `--confirm-real-transfer`;
3. checks the wallet integration;
4. **simulates** through KeeperHub (`simulate: true`) — a would-revert or an
   insufficient-balance result stops the flow, nothing is broadcast;
5. broadcasts through KeeperHub's direct execution with a stable
   `Idempotency-Key` derived as
   `sha256(taskId|8453|recipient|amount|tokenAddress)` (canonicalized);
6. polls `get_direct_execution_status` with bounded backoff until a terminal
   state, stopping on `completed` or `failed`;
7. prints the proof block:

```
SOLVO / KEEPERHUB EXECUTION PROOF
STATUS             COMPLETED
NETWORK            BASE / 8453
ASSET              USDC
AMOUNT             0.01
RECIPIENT          0x…
EXECUTION ID       direct_…
TX HASH            0x…
TRANSACTION LINK   https://basescan.org/tx/0x…
GAS USED (WEI)     …
RECEIPT VERIFIED   YES (chain re-fetched)
```

## Inspecting an execution afterward

- The execution ID and transaction hash are printed by the proof script.
- The transaction link opens the Basescan explorer entry.
- KeeperHub's status response includes chain-re-fetched receipts
  (`verified`, `receiptStatus`, `blockNumber`, `gasUsed`) — the authoritative
  proof — plus `sponsored` (whether gas was sponsored) and
  `gasUsedWei`.

## What NOT to do after an unknown or ambiguous result

- **Do not automatically retry** a broadcast after a timeout, a dropped
  connection, or any outcome where the execution state is unknown. The same
  `Idempotency-Key` would replay the original outcome for 24 hours; a *new*
  key could broadcast a second transaction for work already in flight.
- Inspect the execution in KeeperHub first, then decide whether a retry with
  the same task id is correct.

## Failure classification

The adapter distinguishes:

- **A — rejected before execution:** KeeperHub refused the request (invalid
  recipient, simulation revert, spending cap). Nothing was broadcast.
- **B — accepted but failed:** KeeperHub returned a terminal `failed` status.
  No automatic retry is attempted.
- **C — unknown:** transport/timeout/status-lookup failure. The script stops
  and instructs the operator to inspect before retrying.

Kinds surfaced: missing configuration, invalid API key, wallet not configured,
invalid recipient, invalid amount, cap exceeded, insufficient balance,
unsupported token/network, KeeperHub rejection, execution failure, status
lookup failure, timeout/transport failure, unknown.

## Code layout

- `src/server/keeperhub/` — reusable server-only module:
  `mcp-client.ts` (MCP transport), `adapter.ts` (wallet, simulate, execute,
  status, normalization, schema discovery), `errors.ts` (classification),
  `config.ts` (env validation), `address.ts` (EIP-55), `amount.ts`
  (parse + cap), `idempotency.ts` (stable keys), `proof-command.ts`
  (proof validation logic).
- `scripts/` — the developer-only entry points above. There is no
  browser-accessible endpoint that can spend KeeperHub funds in M1.
- `tests/keeperhub/` — offline unit tests (node:test). `npm test` never
  touches the network and never moves funds.

## Security warnings

- The API key is an organization credential that can authorize onchain
  spend. Keep it server-side; revoke it if compromised.
- No public UI executes anything in M1. The frontend remains truthful:
  sandbox, judge, claim and receipt surfaces show empty states only.
- The `--confirm-real-transfer` flag is a deliberate confirmation barrier,
  not a bypass.
