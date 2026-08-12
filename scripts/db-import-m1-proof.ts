import { createDbClient } from "../src/server/db/client.ts";
import { getDatabaseUrl } from "../src/server/db/config.ts";
import {
  DEV_WORKSPACE_ID,
  M1_AMOUNT_BASE_UNITS,
  M1_EXECUTION_ID,
  M1_EXPLORER_URL,
  M1_RECIPIENT,
  M1_SENDER_WALLET,
  M1_TRANSACTION_HASH,
} from "../src/server/db/constants.ts";
import { PostgresRepository } from "../src/server/db/postgres-repository.ts";
import { deriveIdempotencyKey } from "../src/server/keeperhub/idempotency.ts";
import { baseUnitsToUsdc } from "../src/server/execution/money.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";

const M1_IDEMPOTENCY_TASK_ID = "solvo-m1-proof-import";
const M1_CHAIN_ID = "8453";
const M1_TOKEN_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

async function main(): Promise<number> {
  loadEnvForScript();
  try {
    getDatabaseUrl();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const sql = createDbClient({ max: 1 });
  const repo = new PostgresRepository(sql);
  try {
    let workspace = await repo.getWorkspaceById(DEV_WORKSPACE_ID);
    if (!workspace) {
      workspace = await repo.createWorkspace({
        mode: "development",
        name: "Development",
        chainId: M1_CHAIN_ID,
        tokenAddress: M1_TOKEN_ADDRESS,
        perTransactionLimitBaseUnits: "100000",
        dailyLimitBaseUnits: "1000000",
        approvalPolicy: "auto",
      });
      console.log("Created development workspace: " + workspace.id);
    } else {
      console.log("Development workspace found: " + workspace.id);
    }

    const idempotencyKey = deriveIdempotencyKey({
      taskId: M1_IDEMPOTENCY_TASK_ID,
      chainId: M1_CHAIN_ID,
      recipientAddress: M1_RECIPIENT,
      amount: baseUnitsToUsdc(M1_AMOUNT_BASE_UNITS),
      tokenAddress: M1_TOKEN_ADDRESS,
    });

    const result = await repo.transaction(async (tx) => {
      const existing = await tx.getPayoutItemByIdempotencyKey(idempotencyKey);
      if (existing) {
        return { alreadyImported: true as const, item: existing };
      }

      const payout = await tx.createPayout({
        workspaceId: workspace.id,
        requesterId: null,
        sourceType: "m1_proof",
        status: "completed",
        totalAmountBaseUnits: M1_AMOUNT_BASE_UNITS.toString(),
        currencySymbol: "USDC",
        chainId: M1_CHAIN_ID,
        tokenAddress: M1_TOKEN_ADDRESS,
      });

      const { created, item } = await tx.createPayoutItem({
        payoutId: payout.id,
        recipientAddress: M1_RECIPIENT,
        amountBaseUnits: M1_AMOUNT_BASE_UNITS.toString(),
        memo: "M1 KeeperHub execution proof (development import)",
        status: "completed",
        idempotencyKey,
      });

      if (!created) {
        return { alreadyImported: true as const, item };
      }

      await tx.setPayoutItemKeeperHubExecution(item.id, M1_EXECUTION_ID);
      await tx.setPayoutItemAttemptCount(item.id, 1);
      await tx.completePayoutItem(item.id, M1_TRANSACTION_HASH, M1_EXPLORER_URL);

      const attempt = await tx.createExecutionAttempt({
        payoutItemId: item.id,
        attemptNumber: 1,
        phase: "execution",
        status: "succeeded",
      });
      await tx.updateExecutionAttempt(attempt.id, {
        keeperhubExecutionId: M1_EXECUTION_ID,
        transactionHash: M1_TRANSACTION_HASH,
        rawKeeperhubStatus: {
          status: "completed",
          executionId: M1_EXECUTION_ID,
          transactionHash: M1_TRANSACTION_HASH,
          senderWallet: M1_SENDER_WALLET,
        },
        completedAt: new Date().toISOString(),
      });

      const audits = [
        { eventType: "request_created", metadata: { source: "m1-proof-import" } },
        { eventType: "validation_passed", metadata: { source: "m1-proof-import" } },
        { eventType: "simulation_passed", metadata: { source: "m1-proof-import" } },
        { eventType: "execution_submitted", metadata: { executionId: M1_EXECUTION_ID } },
        { eventType: "execution_completed", metadata: { executionId: M1_EXECUTION_ID, transactionHash: M1_TRANSACTION_HASH } },
        {
          eventType: "m1_proof_imported",
          metadata: {
            provenance: "M1 real KeeperHub execution",
            senderWallet: M1_SENDER_WALLET,
            executionId: M1_EXECUTION_ID,
            transactionHash: M1_TRANSACTION_HASH,
            importedAt: new Date().toISOString(),
          },
        },
      ];
      for (const audit of audits) {
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: audit.eventType,
          actorType: "operator",
          actorId: "m1-proof-import",
          metadata: audit.metadata,
        });
      }

      return { alreadyImported: false as const, item };
    });

    if (result.alreadyImported) {
      console.log("M1 proof already imported.");
      console.log("ITEM ID           " + result.item.id);
      console.log("IDEMPOTENCY KEY   " + result.item.idempotency_key);
      return 0;
    }

    console.log("M1 PROOF IMPORTED");
    console.log("NETWORK           Base / 8453");
    console.log("ASSET             USDC");
    console.log("AMOUNT            " + baseUnitsToUsdc(M1_AMOUNT_BASE_UNITS));
    console.log("RECIPIENT         " + M1_RECIPIENT);
    console.log("EXECUTION ID      " + M1_EXECUTION_ID);
    console.log("TX HASH           " + M1_TRANSACTION_HASH);
    console.log("TRANSACTION LINK  " + M1_EXPLORER_URL);
    console.log("");
    console.log("This is the real M1 KeeperHub execution recorded as development/M1 proof provenance. It is not displayed on any public route.");
    return 0;
  } catch (error) {
    console.error("M1 PROOF IMPORT FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    await sql.end();
  }
}

process.exit(await main());
