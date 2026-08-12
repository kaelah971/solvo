import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { getConfig, KEEPERHUB_CHAIN_ID, KEEPERHUB_CHAIN_NAME, KEEPERHUB_USDC_SYMBOL, loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { KeeperHubConfigError } from "../src/server/keeperhub/config.ts";
import { SolvoError } from "../src/server/keeperhub/errors.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";
import { buildProofRequest, proofWarningBlock } from "../src/server/keeperhub/proof-command.ts";

const PROOF_CAP = "0.10";

type ParsedArgs = {
  to: string;
  amount: string;
  confirmed: boolean;
  taskId?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { to: "", amount: "", confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--to":
        args.to = argv[++i] ?? "";
        break;
      case "--amount":
        args.amount = argv[++i] ?? "";
        break;
      case "--task-id":
        args.taskId = argv[++i] ?? "";
        break;
      case "--confirm-real-transfer":
        args.confirmed = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        if (token.startsWith("--")) {
          const eq = token.indexOf("=");
          if (eq > 0) {
            const name = token.slice(0, eq);
            const value = token.slice(eq + 1);
            if (name === "--to") args.to = value;
            else if (name === "--amount") args.amount = value;
            else if (name === "--task-id") args.taskId = value;
            else {
              console.error(`Unknown option: ${name}`);
              printUsage();
              process.exit(2);
            }
          } else {
            console.error(`Unknown option: ${token}`);
            printUsage();
            process.exit(2);
          }
        } else {
          console.error(`Unexpected argument: ${token}`);
          printUsage();
          process.exit(2);
        }
    }
  }
  return args;
}

function printUsage(): void {
  console.log(
    [
      "Usage: npm run keeperhub:transfer-proof -- --to <0x...> --amount <usdc> [--task-id <id>] [--confirm-real-transfer]",
      "",
      "  --to                    Recipient EVM address (checksummed or lowercase).",
      "  --amount                USDC amount. Hard cap is " + PROOF_CAP + " USDC.",
      "  --task-id               Stable identifier for the idempotency key (default: solvo-dev-proof).",
      "  --confirm-real-transfer Required. Broadcasts a REAL USDC transaction on " + KEEPERHUB_CHAIN_NAME + " mainnet.",
    ].join("\n"),
  );
}

function row(label: string, value: string): string {
  return label.padEnd(22) + value;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  let config;
  try {
    loadEnvForScript();
    config = getConfig();
  } catch (error) {
    if (error instanceof KeeperHubConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const validation = buildProofRequest({
    to: parsed.to,
    amount: parsed.amount,
    confirmed: parsed.confirmed,
    taskId: parsed.taskId,
    usdcTokenAddress: config.usdcTokenAddress,
  });
  if (!validation.ok) {
    console.error(validation.reason);
    return 2;
  }

  const { request, taskId } = validation;

  console.log(proofWarningBlock(request, taskId));
  console.log("");

  if (!parsed.confirmed) {
    console.error("CONFIRMATION REQUIRED");
    console.error("Re-run with --confirm-real-transfer to broadcast. Nothing was sent.");
    return 2;
  }

  const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey, timeoutMs: 180_000 });
  const adapter = new KeeperHubAdapter(client);

  try {
    await adapter.connect();
  } catch (error) {
    console.error("CONNECTION FAILED");
    console.error(String(error));
    return 2;
  }

  try {
    console.log(row("CONNECTED", adapter.url));
    console.log("");

    const wallet = await adapter.getWalletIntegration();
    if (!wallet.configured) {
      console.error("KEEPERHUB WALLET NOT CONFIGURED");
      console.error("Configure a wallet integration at app.keeperhub.com before broadcasting.");
      return 2;
    }
    console.log(row("WALLET", wallet.address ?? "configured (address unavailable)"));

    console.log("");
    console.log("SIMULATING THROUGH KEEPERHUB (no broadcast)");
    const simulation = await adapter.simulateTransfer({
      chainId: request.chainId,
      recipientAddress: request.recipientAddress,
      amount: request.amount,
      tokenAddress: request.tokenAddress,
    });
    if (!simulation.success || simulation.wouldRevert) {
      console.error("SIMULATION FAILED — NOTHING WAS BROADCAST");
      if (simulation.code === "insufficient_balance") {
        console.error(
          "The organization wallet has insufficient funds. " +
            (simulation.revertReason ?? "Fund the wallet and retry."),
        );
      } else {
        console.error(simulation.revertReason ?? simulation.error ?? "The transfer would revert.");
      }
      return 2;
    }
    console.log("Simulation passed. No funds were moved.");
    if (simulation.gasEstimate) {
      console.log(row("GAS ESTIMATE", simulation.gasEstimate));
    }
    console.log("");

    console.log("BROADCASTING VIA KEEPERHUB DIRECT EXECUTION");
    const execution = await adapter.executeTransfer(request);
    const executionId = execution.executionId;
    if (!executionId) {
      console.error("KeeperHub did not return an execution ID.");
      console.error("The outcome is UNKNOWN. Inspect KeeperHub before trying again.");
      return 3;
    }
    console.log(row("EXECUTION ID", executionId));

    if (execution.status === "completed") {
      printProof(request, execution);
      return 0;
    }
    if (execution.status === "failed") {
      printFailure(execution);
      return 3;
    }

    console.log(row("EXECUTION", execution.status.toUpperCase()));
    console.log("Waiting for a terminal state…");
    const terminal = await adapter.pollUntilTerminal(executionId);
    if (terminal.status === "completed") {
      printProof(request, terminal);
      return 0;
    }
    printFailure(terminal);
    return 3;
  } catch (error) {
    if (error instanceof SolvoError) {
      console.error(error.message);
      if (error.detail) console.error("DETAIL: " + error.detail);
      console.error("");
      if (error.kind === "rejected_before_execution") {
        console.error("OUTCOME: rejected before execution. Nothing was broadcast.");
      } else if (error.kind === "execution_failed") {
        console.error("OUTCOME: KeeperHub accepted the request but execution failed.");
      } else {
        console.error("OUTCOME: UNKNOWN. Do NOT retry automatically. Inspect the execution in KeeperHub first.");
      }
      return 3;
    }
    console.error("UNEXPECTED ERROR");
    console.error(String(error));
    return 3;
  } finally {
    await adapter.close();
  }
}

function printProof(request: { recipientAddress: string; amount: string }, status: {
  transactionHash: string | null;
  transactionLink: string | null;
  executionId: string;
  gasUsedWei?: string | null;
  receipts?: Array<{ verified: boolean; gasUsed: string | null }>;
}): void {
  console.log("");
  console.log("SOLVO / KEEPERHUB EXECUTION PROOF");
  console.log("STATUS             COMPLETED");
  console.log(row("NETWORK", `${KEEPERHUB_CHAIN_NAME} / ${KEEPERHUB_CHAIN_ID}`));
  console.log(row("ASSET", KEEPERHUB_USDC_SYMBOL));
  console.log(row("AMOUNT", request.amount));
  console.log(row("RECIPIENT", request.recipientAddress));
  console.log(row("EXECUTION ID", status.executionId));
  console.log(row("TX HASH", status.transactionHash ?? "—"));
  if (status.transactionLink) {
    console.log(row("TRANSACTION LINK", status.transactionLink));
  }
  const receipt = status.receipts?.[0];
  if (status.gasUsedWei) {
    console.log(row("GAS USED (WEI)", status.gasUsedWei));
  } else if (receipt?.gasUsed) {
    console.log(row("GAS USED", receipt.gasUsed));
  }
  if (receipt) {
    console.log(row("RECEIPT VERIFIED", receipt.verified ? "YES (chain re-fetched)" : "NO"));
  }
  console.log("");
  console.log("The transaction was executed through KeeperHub, not through a direct RPC client.");
}

function printFailure(status: { executionId: string; error: string | null; transactionHash: string | null }): void {
  console.error("");
  console.error("EXECUTION FAILED");
  console.error(row("EXECUTION ID", status.executionId));
  console.error(row("TX HASH", status.transactionHash ?? "none"));
  console.error(row("ERROR", status.error ?? "KeeperHub reported failure"));
  console.error("");
  console.error("OUTCOME: KeeperHub accepted the request but execution failed. No automatic retry was attempted.");
}

process.exit(await main());
