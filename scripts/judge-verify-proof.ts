import { createDbClient } from "../src/server/db/client.ts";
import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";
import { getConfig, loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { getJudgeConfig } from "../src/server/judge/config.ts";
import { JUDGE_DAILY_SPEND_STATES, JUDGE_SUCCESSFUL_STATES, utcDayStartIso } from "../src/server/telegram/flows/judge-flow.ts";

/**
 * FINAL JUDGE PROOF — READ-ONLY verification of the public self-serve judge
 * payment. Never calls execute_transfer, never writes, never retries.
 */

const EXECUTION_ID = "gynx68ewlsliieojk33dg";
const TX_HASH = "0x81b61704780fa0d8a983bf15d01c6043ee7f42cd730499649de23137d932c25c";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_URL = "https://mainnet.base.org";
const EXPECTED_BASE_UNITS = 10000n;

type Row = Record<string, unknown>;

function redactUserId(id: unknown): string {
  const raw = String(id ?? "");
  if (!raw) return "—";
  return raw.slice(0, 3) + "…" + raw.slice(-4) + " (" + raw.length + " digits)";
}

async function main(): Promise<number> {
  loadEnvForScript();
  let problems = 0;
  const fail = (message: string): void => {
    console.error("  ✗ " + message);
    problems += 1;
  };
  const ok = (message: string): void => console.log("  ✓ " + message);

  console.log("SOLVO / FINAL JUDGE PROOF VERIFICATION (READ-ONLY)");
  console.log("execution: " + EXECUTION_ID);
  console.log("tx:        " + TX_HASH);
  console.log("");

  // ── 1-7, 15-17: Supabase persisted proof ───────────────────────────────
  console.log("1) SUPABASE — PERSISTED JUDGE PAYOUT");
  const sql = createDbClient({ max: 1 });
  let requesterId: string | null = null;
  let workspaceId: string | null = null;
  try {
    const rows = await sql<Row[]>`
      SELECT pi.id AS item_id, pi.payout_id, pi.recipient_address, pi.amount_base_units,
             pi.memo, pi.status AS item_status, pi.keeperhub_execution_id, pi.transaction_hash,
             pi.idempotency_key, pi.attempt_count, pi.completed_at,
             p.workspace_id, p.requester_id, p.source_type, p.status AS payout_status,
             p.total_amount_base_units, p.chain_id, p.token_address,
             w.mode AS workspace_mode, w.status AS workspace_status
      FROM payout_items pi
      JOIN payouts p ON p.id = pi.payout_id
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE pi.keeperhub_execution_id = ${EXECUTION_ID}
    `;
    if (rows.length === 0) {
      fail("no payout item persisted for execution " + EXECUTION_ID);
    } else if (rows.length > 1) {
      fail("more than one item references this execution ID");
    } else {
      const r = rows[0];
      requesterId = r.requester_id !== null && r.requester_id !== undefined ? String(r.requester_id) : null;
      workspaceId = r.workspace_id !== null && r.workspace_id !== undefined ? String(r.workspace_id) : null;
      const payoutId = String(r.payout_id);
      const itemId = String(r.item_id);
      console.log("  payout id:            " + r.payout_id);
      console.log("  item id:              " + r.item_id);
      console.log("  requester (redacted): " + redactUserId(r.requester_id));
      console.log("  workspace mode:       " + r.workspace_mode);
      console.log("  source type:          " + r.source_type);
      console.log("  amount base units:    " + r.amount_base_units);
      console.log("  recipient:            " + r.recipient_address);
      console.log("  item status:          " + r.item_status);
      console.log("  payout status:        " + r.payout_status);
      console.log("  execution id:         " + r.keeperhub_execution_id);
      console.log("  tx hash:              " + r.transaction_hash);
      console.log("  attempt count:        " + r.attempt_count);
      console.log("  idempotency key:      " + r.idempotency_key);

      // 2. source
      if (r.source_type !== "judge_telegram") {
        fail("source type is not judge_telegram");
      } else {
        ok("source is judge_telegram");
      }
      // 3. policy public self-serve — audit metadata flag
      const audit = await sql<Row[]>`
        SELECT event_type, actor_type, actor_id, metadata
        FROM audit_events WHERE payout_id = ${payoutId} ORDER BY created_at, id
      `;
      const created = audit.find((e) => e.event_type === "request_created");
      const metadata = (created?.metadata ?? {}) as Record<string, unknown>;
      const approval = audit.find((e) => e.event_type === "approval_granted");
      console.log("  audit events:         " + audit.map((e) => String(e.event_type)).join(", "));
      if (metadata.public !== true) {
        fail("audit does not flag the payment as public self-serve");
      } else {
        ok("judge policy path: public self-serve (audit public=true)");
      }
      if (!approval) {
        fail("no approval_granted audit event");
      } else {
        ok("auto-approval recorded (no human approval in Judge Mode)");
        const approvalMeta = (approval.metadata ?? {}) as Record<string, unknown>;
        console.log("    auto-approval reason: " + String(approvalMeta.reason ?? ""));
      }
      // 4. amount
      if (BigInt(String(r.amount_base_units)) !== EXPECTED_BASE_UNITS) {
        fail("amount is not exactly 10000 base units");
      } else {
        ok("amount is exactly 10000 base units = 0.01 USDC");
      }
      if (BigInt(String(r.total_amount_base_units)) !== EXPECTED_BASE_UNITS) {
        fail("payout total is not exactly 10000 base units");
      } else {
        ok("payout total = 10000 base units");
      }
      // 5. recipient
      if (String(r.recipient_address).toLowerCase() !== RECIPIENT) {
        fail("persisted recipient does not match " + RECIPIENT);
      } else {
        ok("recipient matches");
      }
      // 6. execution id
      if (String(r.keeperhub_execution_id) !== EXECUTION_ID) {
        fail("persisted execution ID does not match");
      } else {
        ok("execution ID matches");
      }
      // 7. tx hash
      if (String(r.transaction_hash) !== TX_HASH) {
        fail("persisted tx hash does not match");
      } else {
        ok("tx hash matches");
      }
      if (r.item_status !== "completed" || r.payout_status !== "completed") {
        fail("item/payout are not completed");
      } else {
        ok("item and payout are completed");
      }
      if (r.workspace_mode !== "judge" || r.workspace_status !== "active") {
        fail("workspace is not an active judge workspace");
      } else {
        ok("judge workspace, active");
      }
      if (String(r.chain_id) !== "8453" || String(r.token_address).toLowerCase() !== USDC) {
        fail("payout chain/token mismatch");
      } else {
        ok("chain 8453 / canonical Base USDC persisted");
      }

      // 17. no duplicate execution
      const attempts = await sql<Row[]>`
        SELECT ea.id, ea.phase, ea.status, ea.keeperhub_execution_id, ea.transaction_hash
        FROM execution_attempts ea WHERE ea.payout_item_id = ${itemId}
      `;
      const execAttempts = attempts.filter((a) => a.phase === "execution");
      console.log("  execution_attempts:   " + attempts.length + " row(s)");
      if (execAttempts.length !== 1) {
        fail("expected exactly one execution-phase attempt, found " + execAttempts.length);
      } else {
        ok("exactly one execution-phase attempt (no duplicate execution)");
        if (String(execAttempts[0].status) !== "succeeded") fail("execution attempt is not succeeded");
        if (String(execAttempts[0].keeperhub_execution_id) !== EXECUTION_ID) fail("attempt execution id mismatch");
        if (String(execAttempts[0].transaction_hash) !== TX_HASH) fail("attempt tx hash mismatch");
      }
      const submissions = audit.filter((e) => e.event_type === "execution_submitted");
      const completions = audit.filter((e) => e.event_type === "execution_completed");
      if (submissions.length !== 1 || completions.length !== 1) {
        fail("audit shows " + submissions.length + " submitted / " + completions.length + " completed events");
      } else {
        ok("audit shows exactly one execution_submitted + execution_completed");
      }
      if (Number(r.attempt_count) !== 1) {
        fail("attempt_count is not 1");
      } else {
        ok("attempt_count = 1");
      }
    }
  } catch (error) {
    fail("Supabase query failed: " + (error instanceof Error ? error.message : String(error)));
  }

  // ── 15-16: daily spend + per-user cap ──────────────────────────────────
  if (workspaceId && requesterId) {
    try {
      const todaySpend = await sql<{ total: string | null }[]>`
        SELECT sum(pi.amount_base_units) AS total
        FROM payout_items pi
        JOIN payouts p ON p.id = pi.payout_id
        WHERE p.workspace_id = ${workspaceId}
          AND pi.status::text = ANY(${[...JUDGE_DAILY_SPEND_STATES] as string[]})
          AND pi.created_at >= ${utcDayStartIso()}
      `;
      const spend = BigInt(todaySpend[0]?.total ?? "0");
      const judge = getJudgeConfig();
      console.log("");
      console.log("2) DAILY + PER-USER CAPS");
      console.log("  today's judge spend:  " + spend.toString() + " base units (cap " + judge.dailyLimitBaseUnits + ")");
      if (spend !== EXPECTED_BASE_UNITS) {
        fail("daily judge spend is not exactly 10000 base units");
      } else {
        ok("daily judge spend updated 0 → 10000 base units = 0.01 USDC");
      }
      const userCompleted = await sql<{ n: string }[]>`
        SELECT count(*) AS n
        FROM payout_items pi
        JOIN payouts p ON p.id = pi.payout_id
        WHERE p.workspace_id = ${workspaceId}
          AND p.requester_id = ${requesterId}
          AND pi.status::text = ANY(${[...JUDGE_SUCCESSFUL_STATES] as string[]})
      `;
      const completedCount = Number(userCompleted[0].n);
      console.log("  user completed count: " + completedCount + " (cap " + judge.maxSuccessfulPaymentsPerUser + ")");
      if (completedCount !== judge.maxSuccessfulPaymentsPerUser) {
        fail("per-user successful count does not equal the cap");
      } else {
        ok("this Telegram user is now capped from another public judge success (" + completedCount + "/" + judge.maxSuccessfulPaymentsPerUser + ")");
      }
    } catch (error) {
      fail("cap queries failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }
  await sql.end();
  console.log("");

  // ── KeeperHub read-only status ─────────────────────────────────────────
  console.log("3) KEEPERHUB — READ-ONLY EXECUTION STATUS");
  const config = getConfig();
  const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey, timeoutMs: 30_000 });
  const adapter = new KeeperHubAdapter(client);
  try {
    await adapter.connect();
    const status = await adapter.getDirectExecutionStatus(EXECUTION_ID);
    console.log("  status:               " + status.status);
    console.log("  type:                 " + (status.type ?? "n/a"));
    console.log("  tx hash:              " + (status.transactionHash ?? "none"));
    console.log("  sponsored:            " + String(status.sponsored ?? "n/a"));
    for (const receipt of status.receipts) {
      console.log("    chain " + receipt.chainId +
        " verified=" + String(receipt.verified) +
        " receiptStatus=" + receipt.receiptStatus +
        " block=" + String(receipt.blockNumber ?? "n/a") +
        " gasUsed=" + String(receipt.gasUsed ?? "n/a"));
    }
    if (status.status !== "completed") {
      fail("KeeperHub final state is not completed");
    } else {
      ok("KeeperHub status: completed");
    }
    if (status.transactionHash !== TX_HASH) {
      fail("KeeperHub tx hash does not match");
    } else {
      ok("KeeperHub tx hash matches");
    }
    const verifiedReceipts = status.receipts.filter((r) => r.verified === true);
    if (verifiedReceipts.length !== 1) {
      fail("expected exactly one verified receipt");
    } else {
      ok("KeeperHub receipt verified = true");
      if (verifiedReceipts[0].chainId !== 8453) {
        fail("receipt chain is not 8453");
      } else {
        ok("receipt chain 8453 (Base)");
      }
      if (verifiedReceipts[0].receiptStatus !== "success") {
        fail("receipt status is not success");
      } else {
        ok("receipt status: success");
      }
    }
  } catch (error) {
    fail("KeeperHub status lookup failed: " + (error instanceof Error ? error.message : String(error)));
  }
  await adapter.close();
  console.log("");

  // ── Base mainnet RPC ───────────────────────────────────────────────────
  console.log("4) BASE MAINNET — READ-ONLY TRANSACTION VERIFICATION");
  let rpcId = 0;
  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    rpcId += 1;
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };
  try {
    const chainId = BigInt(String(await rpc("eth_chainId", []))).toString();
    if (chainId !== "8453") {
      fail("RPC chain id is " + chainId + ", expected 8453");
    } else {
      ok("chain id 8453 (Base mainnet)");
    }
    const tx = (await rpc("eth_getTransactionByHash", [TX_HASH])) as Record<string, unknown> | null;
    if (!tx) {
      fail("transaction does not exist on Base");
    } else {
      ok("transaction exists on Base");
      const txChainId = BigInt(String(tx.chainId ?? "0"));
      if (txChainId !== 8453n) {
        fail("tx chainId is " + txChainId + ", expected 8453");
      } else {
        ok("tx chainId 8453");
      }
    }
    const receipt = (await rpc("eth_getTransactionReceipt", [TX_HASH])) as Record<string, unknown> | null;
    if (!receipt) {
      fail("no receipt for " + TX_HASH);
    } else {
      const statusHex = BigInt(String(receipt.status));
      if (statusHex !== 1n) {
        fail("receipt status is " + statusHex + ", expected success");
      } else {
        ok("receipt status: success");
      }
      const logs = receipt.logs as Array<{ address: string; topics: string[]; data: string }>;
      const transfers = logs.filter(
        (l) => l.address.toLowerCase() === USDC.toLowerCase() && l.topics[0].toLowerCase() === TRANSFER_TOPIC,
      );
      if (transfers.length === 0) {
        fail("no canonical Base USDC Transfer event");
      } else if (transfers.length > 1) {
        fail("more than one canonical Base USDC Transfer event");
      } else {
        const t = transfers[0];
        const from = "0x" + t.topics[1].slice(26);
        const to = "0x" + t.topics[2].slice(26);
        const amount = BigInt(t.data);
        console.log("    USDC contract: " + t.address);
        console.log("    transfer.from: " + from);
        console.log("    transfer.to:   " + to);
        console.log("    amount:        " + amount.toString() + " base units");
        if (t.address.toLowerCase() !== USDC) {
          fail("token is not canonical Base USDC");
        } else {
          ok("USDC token is 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
        }
        if (amount !== EXPECTED_BASE_UNITS) {
          fail("transferred amount is not exactly 10000 base units");
        } else {
          ok("transfer amount is exactly 10000 base units = 0.01 USDC");
        }
        if (to.toLowerCase() !== RECIPIENT) {
          fail("transfer recipient does not match");
        } else {
          ok("transfer recipient matches");
        }
        try {
          const wallet = await adapter.getWalletIntegration();
          if (wallet.address && from.toLowerCase() === wallet.address.toLowerCase()) {
            ok("transfer sender is the configured KeeperHub wallet");
          } else {
            console.log("    (transfer sender " + from + " — KeeperHub wallet " + (wallet.address ?? "unknown") + ")");
          }
        } catch {
          // wallet check is informational only
        }
      }
    }
    console.log("");
    console.log("  BASESCAN  https://basescan.org/tx/" + TX_HASH);
  } catch (error) {
    fail("Base RPC verification failed: " + (error instanceof Error ? error.message : String(error)));
  }
  console.log("");

  if (problems > 0) {
    console.error("VERIFICATION FAILED — " + problems + " problem(s). Read-only only; nothing executed.");
    return 2;
  }
  console.log("FINAL SUBMISSION PROOF VERIFIED");
  return 0;
}

process.exit(await main());
