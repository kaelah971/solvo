import { createDbClient } from "../src/server/db/client.ts";
import { getRealExecutionGateway } from "../src/server/telegram/flows/execution-gateway.ts";
import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";

/**
 * M3 read-only proof verification.
 *
 * Queries Supabase for the persisted payout item, asks KeeperHub for the
 * read-only execution status, and verifies the transaction on Base mainnet
 * through a public RPC (status, canonical USDC Transfer event, exact amount).
 *
 * This script has NO execution capability: it never calls execute_transfer,
 * never creates a payout, and never rebroadcasts. Run:
 *
 *   npm run m3:verify-proof            # verified execution from 2026-08-11
 *   npm run m3:verify-proof -- --execution-id <id>
 */

const DEFAULT_EXECUTION_ID = "idk1qp7e6x326xd61sa30";
const DEFAULT_TX_HASH = "0x8a56df12a94a25c97cfb71cc3a86a14f2a65c65298833ff0489ffb865be43201";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_URL = "https://mainnet.base.org";

type Row = Record<string, unknown>;

function parseArgs(argv: string[]): { executionId: string } {
  let executionId = DEFAULT_EXECUTION_ID;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--execution-id") {
      executionId = argv[++i] ?? DEFAULT_EXECUTION_ID;
    } else if (token.startsWith("--execution-id=")) {
      executionId = token.slice("--execution-id=".length);
    }
  }
  return { executionId };
}

async function main(): Promise<number> {
  const { executionId } = parseArgs(process.argv.slice(2));
  loadEnvForScript();

  let problems = 0;
  const fail = (message: string): void => {
    console.error("  ✗ " + message);
    problems += 1;
  };
  const ok = (message: string): void => console.log("  ✓ " + message);

  console.log("SOLVO / M3 PROOF VERIFICATION (READ-ONLY)");
  console.log("EXECUTION ID          " + executionId);
  console.log("");

  console.log("1) SUPABASE — PERSISTED PAYOUT ITEM");
  const sql = createDbClient({ max: 1 });
  let txHash = DEFAULT_TX_HASH;
  try {
    const rows = await sql<Row[]>`
      SELECT pi.id AS item_id, pi.payout_id, pi.status AS item_status,
             pi.recipient_address, pi.amount_base_units, pi.idempotency_key,
             pi.keeperhub_execution_id, pi.transaction_hash, pi.transaction_explorer_url,
             p.status AS payout_status, p.chain_id AS payout_chain, p.token_address AS payout_token,
             w.mode AS workspace_mode
      FROM payout_items pi
      JOIN payouts p ON p.id = pi.payout_id
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE pi.keeperhub_execution_id = ${executionId}
    `;
    if (rows.length === 0) {
      fail("no payout item persisted for execution " + executionId);
    } else if (rows.length > 1) {
      fail("more than one item references this execution ID");
    } else {
      const row = rows[0];
      console.log("  payout id:            " + row.payout_id);
      console.log("  item id:              " + row.item_id);
      console.log("  item status:          " + row.item_status);
      console.log("  payout status:        " + row.payout_status);
      console.log("  idempotency key:      " + row.idempotency_key);
      console.log("  amount base units:    " + row.amount_base_units);
      console.log("  recipient:            " + row.recipient_address);
      console.log("  chain:                " + row.payout_chain);
      console.log("  token:                " + row.payout_token);
      console.log("  workspace mode:       " + row.workspace_mode);
      txHash = row.transaction_hash !== null && row.transaction_hash !== undefined
        ? String(row.transaction_hash)
        : txHash;
      if (row.item_status !== "completed" || row.payout_status !== "completed") {
        fail("item/payout are not in the terminal completed state");
      } else {
        ok("item and payout are completed");
      }
      if (String(row.keeperhub_execution_id) !== executionId) {
        fail("persisted execution ID does not match");
      }
    }
  } finally {
    await sql.end();
  }
  console.log("");

  console.log("2) KEEPERHUB — READ-ONLY EXECUTION STATUS");
  try {
    const adapter = getRealExecutionGateway() as unknown as KeeperHubAdapter;
    const status = await adapter.getDirectExecutionStatus(executionId);
    console.log("  status:               " + status.status);
    console.log("  type:                 " + (status.type ?? "n/a"));
    console.log("  tx hash:              " + (status.transactionHash ?? "none"));
    console.log("  chain (receipt):      " + (status.receipts[0]?.chainId ?? "n/a"));
    console.log("  receipt verified:     " + String(status.receipts[0]?.verified ?? "n/a"));
    console.log("  receipt status:       " + (status.receipts[0]?.receiptStatus ?? "n/a"));
    console.log("  sponsored:            " + String(status.sponsored ?? "n/a"));
    if (status.status !== "completed") {
      fail("KeeperHub final state is not completed");
    } else {
      ok("KeeperHub reports completed");
    }
    if (status.transactionHash && status.transactionHash !== txHash) {
      fail("KeeperHub tx hash does not match the persisted hash");
    } else if (status.transactionHash) {
      txHash = status.transactionHash;
      ok("KeeperHub tx hash matches the persisted hash");
    }
  } catch (error) {
    fail("KeeperHub status lookup failed: " + (error instanceof Error ? error.message : String(error)));
  }
  console.log("");

  console.log("3) BASE MAINNET — READ-ONLY TRANSACTION VERIFICATION");
  let rpcId = 0;
  const rpc = async (method: string, params: unknown[]): Promise<Record<string, unknown>> => {
    rpcId += 1;
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as Record<string, unknown>;
  };
  try {
    const chainId = BigInt(String(await rpc("eth_chainId", []))).toString();
    if (chainId !== "8453") {
      fail("RPC chain id is " + chainId + ", expected 8453");
    } else {
      ok("chain id 8453 (Base mainnet)");
    }
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    const statusHex = BigInt(String(receipt.status));
    if (statusHex !== 1n) {
      fail("transaction receipt status is " + statusHex + ", expected success");
    } else {
      ok("transaction receipt status: success");
    }
    const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string; logIndex: string }>;
    const transfers = logs.filter(
      (l) =>
        l.address.toLowerCase() === USDC.toLowerCase() &&
        l.topics[0].toLowerCase() === TRANSFER_TOPIC,
    );
    if (transfers.length === 0) {
      fail("no canonical Base USDC Transfer event found");
    } else if (transfers.length > 1) {
      fail("more than one canonical Base USDC Transfer event found");
    } else {
      const t = transfers[0];
      const from = "0x" + t.topics[1].slice(26);
      const to = "0x" + t.topics[2].slice(26);
      const amount = BigInt(t.data);
      console.log("  USDC from:            " + from);
      console.log("  USDC to:              " + to);
      console.log("  amount (base units):  " + amount.toString());
      if (amount !== 10000n) {
        fail("transferred amount is not exactly 10000 base units (0.01 USDC)");
      } else {
        ok("transferred exactly 0.01 USDC (10000 base units)");
      }
    }
  } catch (error) {
    fail("Base RPC verification failed: " + (error instanceof Error ? error.message : String(error)));
  }
  console.log("");

  console.log("BASESCAN              https://basescan.org/tx/" + txHash);
  console.log("");
  if (problems > 0) {
    console.error("VERIFICATION FAILED — " + problems + " problem(s). Nothing was executed.");
    return 2;
  }
  console.log("VERIFICATION PASSED. Read-only only; no execution was performed.");
  return 0;
}

process.exit(await main());
