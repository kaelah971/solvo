import type { SolvoRepository } from "../../src/server/db/repository.ts";
import type { SolvoDirectExecutionStatus, SolvoSimulationResult } from "../../src/server/keeperhub/types.ts";
import type { KeeperHubExecutionGateway } from "../../src/server/execution/execution-service.ts";

export const CHAIN_ID = "8453";
export const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
export const TX_HASH = "0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089";

export const SIM_OK: SolvoSimulationResult = {
  success: true,
  wouldRevert: false,
  from: null,
  to: null,
  value: null,
  gasEstimate: "65000",
  revertReason: null,
  code: null,
  balanceWei: null,
  requiredWei: null,
  shortfallWei: null,
  error: null,
};

export function completedStatus(executionId: string): SolvoDirectExecutionStatus {
  return {
    executionId,
    status: "completed",
    type: "transfer",
    transactionHash: TX_HASH,
    transactionLink: `https://basescan.org/tx/${TX_HASH}`,
    sponsored: false,
    receipts: [
      {
        hash: TX_HASH,
        chainId: 8453,
        verified: true,
        receiptStatus: "success",
        blockNumber: 123456,
        gasUsed: "68115",
      },
    ],
    gasUsedWei: "21000000000000",
    error: null,
    createdAt: "2026-08-11T00:00:00Z",
    completedAt: "2026-08-11T00:00:05Z",
  };
}

export class FakeGateway implements KeeperHubExecutionGateway {
  simulateCalls = 0;
  executeCalls = 0;
  statusCalls = 0;
  pollCalls = 0;
  private readonly script: {
    simulate?: SolvoSimulationResult;
    execute?: SolvoDirectExecutionStatus;
    executeError?: unknown;
    poll?: SolvoDirectExecutionStatus;
    pollError?: unknown;
    status?: SolvoDirectExecutionStatus;
    statusError?: unknown;
  };

  constructor(script: {
    simulate?: SolvoSimulationResult;
    execute?: SolvoDirectExecutionStatus;
    executeError?: unknown;
    poll?: SolvoDirectExecutionStatus;
    pollError?: unknown;
    status?: SolvoDirectExecutionStatus;
    statusError?: unknown;
  }) {
    this.script = script;
  }

  async simulateTransfer(): Promise<SolvoSimulationResult> {
    this.simulateCalls += 1;
    return this.script.simulate ?? SIM_OK;
  }

  async executeTransfer(): Promise<SolvoDirectExecutionStatus> {
    this.executeCalls += 1;
    if (this.script.executeError !== undefined) throw this.script.executeError;
    return this.script.execute ?? completedStatus("direct_test_execution");
  }

  async getDirectExecutionStatus(): Promise<SolvoDirectExecutionStatus> {
    this.statusCalls += 1;
    if (this.script.statusError !== undefined) throw this.script.statusError;
    return this.script.status ?? completedStatus("direct_test_execution");
  }

  async pollUntilTerminal(): Promise<SolvoDirectExecutionStatus> {
    this.pollCalls += 1;
    if (this.script.pollError !== undefined) throw this.script.pollError;
    return this.script.poll ?? completedStatus("direct_test_execution");
  }
}

export async function createApprovedItem(repo: SolvoRepository): Promise<{
  itemId: string;
  payoutId: string;
  workspaceId: string;
}> {
  const workspace = await repo.createWorkspace({
    mode: "development",
    name: "Test",
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "auto",
  });
  const payout = await repo.createPayout({
    workspaceId: workspace.id,
    requesterId: null,
    sourceType: "direct",
    status: "approved",
    totalAmountBaseUnits: "10000",
    currencySymbol: "USDC",
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: "10000",
    memo: null,
    status: "approved",
    idempotencyKey: `test-key-${Math.random().toString(36).slice(2)}`,
  });
  return { itemId: item.id, payoutId: payout.id, workspaceId: workspace.id };
}
