import type { WorkspaceMode } from "../db/types.ts";

export type TelegramMode = "sandbox" | "development";

export type TelegramUser = {
  /** Telegram numeric user ID, the only trusted identity primitive. */
  userId: string;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  messageId: number | null;
  updateId: number;
};

export type PayInstruction = {
  kind: "pay";
  address: string;
  amount: string;
  token: "USDC";
  /** how the instruction arrived */
  sourceType: "telegram_command" | "telegram_natural_language";
};

export type PayAliasInstruction = {
  kind: "pay_alias";
  alias: string;
  amount: string;
  token: "USDC";
  sourceType: "telegram_natural_language";
};

export type BatchInstruction = {
  kind: "batch";
  /** raw body after /batch, line-separated; parsed by the batch flow */
  body: string;
};

export type JudgePayInstruction = {
  kind: "judge_pay";
  address: string;
  amount: string;
  token: "USDC";
};

export type StatusInstruction = {
  kind: "status";
  payoutId: string;
};

export type WorkspaceInitInstruction = {
  kind: "workspace_init";
};

export type MemberAddInstruction = {
  kind: "member_add";
  telegramUserId: string;
  role: "member" | "approver" | "owner";
};

export type MemberRemoveInstruction = {
  kind: "member_remove";
  telegramUserId: string;
};

export type MemberListInstruction = {
  kind: "member_list";
};

export type RecipientAddInstruction = {
  kind: "recipient_add";
  alias: string;
  address: string;
};

export type RecipientListInstruction = {
  kind: "recipient_list";
};

export type Instruction =
  | PayInstruction
  | PayAliasInstruction
  | BatchInstruction
  | JudgePayInstruction
  | StatusInstruction
  | WorkspaceInitInstruction
  | MemberAddInstruction
  | MemberRemoveInstruction
  | MemberListInstruction
  | RecipientAddInstruction
  | RecipientListInstruction
  | { kind: "start" }
  | { kind: "help" };

export type ParseFailure = {
  kind: "failure";
  reason: string;
  /** short user-facing hint */
  hint: string;
};

export type ParseResult = Instruction | ParseFailure;

export type PolicyDecision = {
  decision: "auto_approve" | "approval_required" | "blocked" | "approved_for_execution";
  reason: string;
};

export type PayFlowStage = {
  header: string;
  lines: string[];
};

export type PayReply = {
  /** first message is sent, later messages edit the same Telegram message */
  messages: string[];
  final: string;
  /** structured summary for tests */
  outcome: "simulated" | "completed" | "failed" | "unknown" | "blocked" | "duplicate" | "invalid";
  payoutId: string | null;
  itemId: string | null;
};

export type StatusReply = {
  text: string;
  found: boolean;
};

export type ModeMapping = { sandbox: WorkspaceMode; development: WorkspaceMode };

export type CommunityReply = {
  text: string;
  /** optional inline keyboard rows for the group message */
  buttons?: Array<{ text: string; callbackData: string }>;
};

export type CommunityCommandReply = {
  text: string;
  /** structured outcome for tests */
  outcome: "created" | "existing" | "unauthorized" | "wrong_context" | "invalid" | "not_found" | "ok";
};

export type ApprovalCallbackAction = "approve" | "reject";

export type ApprovalCallbackInput = {
  action: ApprovalCallbackAction;
  payoutId: string;
  actorUserId: string;
  chatId: string;
};

export type ApprovalCallbackResult = {
  /** text to show to the actor (via answerCallbackQuery) */
  answer: string;
  /** text replacing the preview message when the callback acted on it */
  edited?: string;
  /** when the callback caused a state change, whether execution was started */
  executed?: boolean;
};
