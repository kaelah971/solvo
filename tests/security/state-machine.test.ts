import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { StateTransitionError } from "../../src/server/execution/state-machine.ts";
import { claimExpiresAtIso } from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

describe("M8 illegal state transitions", () => {
  it("claims reject impossible transitions", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "community",
      name: "T",
      telegramChatId: "-1",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: "1",
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-illegal-1",
    });

    // executed -> claimed / approved
    await repo.transitionClaimStatus(claim.id, ["created"], "claimed");
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    await assert.rejects(repo.transitionClaimStatus(claim.id, ["executed"], "claimed"), StateTransitionError);
    await assert.rejects(repo.transitionClaimStatus(claim.id, ["executed"], "approved"), StateTransitionError);

    // cancelled -> approved
    const token2 = generateClaimTokenPair();
    const c2 = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: "1",
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token2.hash,
      tokenPrefix: token2.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-illegal-2",
    });
    await repo.transitionClaimStatus(c2.id, ["created"], "cancelled");
    await assert.rejects(repo.transitionClaimStatus(c2.id, ["cancelled"], "approved"), StateTransitionError);
    await assert.rejects(repo.transitionClaimStatus(c2.id, ["cancelled"], "executed"), StateTransitionError);

    // expired -> claimed is only effective, never a stored state
    const token3 = generateClaimTokenPair();
    const c3 = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: "1",
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token3.hash,
      tokenPrefix: token3.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-illegal-3",
    });
    await assert.rejects(repo.transitionClaimStatus(c3.id, ["created"], "expired"), StateTransitionError);

    // claimed -> executed without approval
    const token4 = generateClaimTokenPair();
    const c4 = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: "1",
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token4.hash,
      tokenPrefix: token4.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-illegal-4",
    });
    await repo.claimClaimLink({ claimId: c4.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: "2026-08-13T00:00:00.000Z" });
    await assert.rejects(repo.transitionClaimStatus(c4.id, ["claimed"], "executed"), StateTransitionError);
  });

  it("claim payout attachment is rejected before approval and after linking", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "community",
      name: "T2",
      telegramChatId: "-2",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "1",
      sourceType: "claim_link",
      status: "approved",
      totalAmountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });

    // Attaching a payout to a claim that is NOT approved must fail.
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: "1",
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-link-1",
    });
    await assert.rejects(repo.setClaimPayoutId(claim.id, payout.id), /cannot attach payout/);

    // After approval exactly one attachment is allowed.
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: "2026-08-13T00:00:00.000Z" });
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
    await repo.setClaimPayoutId(claim.id, payout.id);
    await assert.rejects(repo.setClaimPayoutId(claim.id, payout.id), /cannot attach payout/);
  });

  it("payout state machine rejects illegal transitions (submitted -> draft etc.)", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: "Dev",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "auto",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: null,
      sourceType: "direct",
      status: "draft",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    await assert.rejects(repo.transitionPayoutState(payout.id, ["draft"], "completed"), StateTransitionError);
    await assert.rejects(repo.transitionPayoutState(payout.id, ["draft"], "submitted"), StateTransitionError);

    await repo.transitionPayoutState(payout.id, ["draft"], "validated");
    await repo.transitionPayoutState(payout.id, ["validated"], "approved");
    await repo.transitionPayoutState(payout.id, ["approved"], "simulating");
    await repo.transitionPayoutState(payout.id, ["simulating"], "submitted");
    await repo.transitionPayoutState(payout.id, ["submitted"], "completed");
    await assert.rejects(repo.transitionPayoutState(payout.id, ["completed"], "submitted"), StateTransitionError);
    await assert.rejects(repo.transitionPayoutState(payout.id, ["completed"], "simulating"), StateTransitionError);
  });
});
