import { serializeBotError } from "../safe-logging.ts";
import {
  applyApprovalCallback,
  validateApprovalCallback,
  type ApprovalFlowDeps,
} from "./approval-flow.ts";
import type { ApprovalCallbackInput } from "../types.ts";

export type ApprovalMessenger = {
  answer(text: string): Promise<void>;
  edit(text: string): Promise<void>;
  reply(text: string): Promise<void>;
};

/**
 * Telegram callback orchestration for community approvals.
 *
 * Ordering contract (fixes the "query is too old" failure):
 *   1. parse the payload
 *   2. cheap KeeperHub-free validation (DB reads only)
 *   3. answerCallbackQuery promptly — never after the KeeperHub execution
 *   4. atomic approval transition + KeeperHub simulation/execution + persistence
 *   5. edit/send the final group message (best-effort)
 *
 * Execution correctness never depends on answerCallbackQuery or message
 * editing succeeding: Telegram API failures are logged sanitized and swallowed
 * so the polling process keeps running and the payment state stays truthful.
 */
export async function handleApprovalCallbackUpdate(
  input: ApprovalCallbackInput,
  deps: ApprovalFlowDeps,
  messenger: ApprovalMessenger,
  onTelegramError: (error: unknown) => void = (error) => {
    console.error(serializeBotError(error, { action: input.action, payoutId: input.payoutId }));
  },
): Promise<void> {
  const validation = await validateApprovalCallback(input, deps);
  if (!validation.ok) {
    const result = validation.result;
    try {
      await messenger.answer(result.answer);
    } catch (error) {
      onTelegramError(error);
    }
    if (result.edited) {
      await editOrReply(messenger, result.edited, onTelegramError);
    }
    return;
  }

  try {
    await messenger.answer("Approval received. Processing payment.");
  } catch (error) {
    onTelegramError(error);
  }

  const applyDeps: ApprovalFlowDeps = {
    repo: deps.repo,
    gateway: deps.gateway,
    onItemProgress: async (message) => {
      await editOrReply(messenger, message, onTelegramError);
    },
  };
  const result = await applyApprovalCallback(validation.context, applyDeps);
  if (result.edited) {
    await editOrReply(messenger, result.edited, onTelegramError);
    return;
  }
  await editOrReply(messenger, result.answer, onTelegramError);
}

async function editOrReply(
  messenger: ApprovalMessenger,
  text: string,
  onTelegramError: (error: unknown) => void,
): Promise<void> {
  try {
    await messenger.edit(text);
  } catch {
    try {
      await messenger.reply(text);
    } catch (error) {
      onTelegramError(error);
    }
  }
}
