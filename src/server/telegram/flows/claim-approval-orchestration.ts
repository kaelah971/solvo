import { serializeBotError } from "../safe-logging.ts";
import {
  applyClaimApprovalCallback,
  validateClaimApprovalCallback,
  type ClaimApprovalCallbackInput,
  type ClaimApprovalCallbackResult,
} from "../../claim/service.ts";
import type { SolvoRepository } from "../../db/repository.ts";
import type { KeeperHubExecutionGateway } from "../../execution/execution-service.ts";

export type ClaimApprovalMessenger = {
  answer(text: string): Promise<void>;
  edit(text: string): Promise<void>;
  reply(text: string): Promise<void>;
};

export type ClaimApprovalFlowDeps = {
  repo: SolvoRepository;
  gateway?: KeeperHubExecutionGateway;
};

/**
 * Telegram callback orchestration for claim approvals — mirrors the payout
 * approval ordering contract: parse → cheap validation → answerCallbackQuery
 * promptly → atomic transition + execution → best-effort edit/reply.
 */
export async function handleClaimApprovalCallbackUpdate(
  input: ClaimApprovalCallbackInput,
  deps: ClaimApprovalFlowDeps,
  messenger: ClaimApprovalMessenger,
  onTelegramError: (error: unknown) => void = (error) => {
    console.error(serializeBotError(error, { action: input.action, payoutId: input.claimId }));
  },
): Promise<void> {
  const validation = await validateClaimApprovalCallback(input, deps.repo);
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
    await messenger.answer("Approval received. Processing claim.");
  } catch (error) {
    onTelegramError(error);
  }

  const result: ClaimApprovalCallbackResult = await applyClaimApprovalCallback(validation.context, deps);
  if (result.edited) {
    await editOrReply(messenger, result.edited, onTelegramError);
    return;
  }
  await editOrReply(messenger, result.answer, onTelegramError);
}

async function editOrReply(
  messenger: ClaimApprovalMessenger,
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
