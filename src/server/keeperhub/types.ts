export type SolvoExecutionStatus = "pending" | "running" | "completed" | "failed" | "unknown";

export type SolvoTransferRequest = {
  chainId: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  idempotencyKey: string;
  /**
   * Optional KeeperHub wallet integration id. Only forwarded when the MCP
   * server's execute_transfer schema advertises an integration selector at
   * runtime; the current schema does not, so this stays unused until the
   * platform exposes per-integration direct execution.
   */
  integrationId?: string;
};

export type SolvoExecutionReceipt = {
  hash: string;
  chainId: number;
  verified: boolean;
  receiptStatus: string;
  blockNumber: number | null;
  gasUsed: string | null;
};

export type SolvoDirectExecutionStatus = {
  executionId: string;
  status: SolvoExecutionStatus;
  type: string | null;
  transactionHash: string | null;
  transactionLink: string | null;
  sponsored: boolean | null;
  receipts: SolvoExecutionReceipt[];
  gasUsedWei: string | null;
  error: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

export type SolvoSimulationResult = {
  success: boolean;
  wouldRevert: boolean;
  from: string | null;
  to: string | null;
  value: string | null;
  gasEstimate: string | null;
  revertReason: string | null;
  code: string | null;
  balanceWei: string | null;
  requiredWei: string | null;
  shortfallWei: string | null;
  error: string | null;
};

export type WalletIntegration = {
  configured: boolean;
  id: string | null;
  name: string | null;
  type: string | null;
  address: string | null;
  chainIds: string[];
  raw: unknown;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type DoctorReport = {
  connection: "ok" | "failed";
  auth: "ok" | "failed";
  walletConfigured: boolean;
  walletAddress: string | null;
  chainSupport: { chainId: string; found: boolean; status: string | null };
  executeTransferTool: boolean;
  statusTool: boolean;
  readyForWrite: boolean;
  missing: string[];
};
