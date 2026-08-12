import type { Metadata } from "next";

import { ClaimPanel } from "@/components/ClaimPanel";
import { PageShell } from "@/components/PageShell";
import { SectionLabel } from "@/components/SectionLabel";
import { getDbRepository } from "@/server/db/accessor";
import { effectiveClaimStatus, getClaimByRawToken } from "@/server/claim/service";
import { baseUnitsToUsdc } from "@/server/execution/money";
import { ClaimForm } from "./ClaimForm";

export const metadata: Metadata = {
  title: "Claim",
  description:
    "Claim a Solvo payment link. The destination address is supplied by the recipient and approved by the sender before anything moves through KeeperHub.",
};

export const dynamic = "force-dynamic";

/**
 * Claim page. Read-only against the claim service: it never moves funds and
 * never creates a payout. Submitting a wallet only records the destination;
 * execution requires sender/approver approval of that exact address.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const nowIso = new Date().toISOString();

  const repo = getDbRepository();
  const lookup = repo ? await getClaimByRawToken(repo, token) : null;

  // Unknown token: render the unavailable state truthfully (no fabricated data).
  if (!lookup) {
    return (
      <PageShell className="pt-10 md:pt-16">
        <div className="mx-auto w-full max-w-3xl">
          <ClaimPanel state="unavailable" />
        </div>
        <ClaimExplanation />
      </PageShell>
    );
  }

  const { claim, workspace } = lookup;
  const status = effectiveClaimStatus(claim, nowIso);
  const amountUsdc = baseUnitsToUsdc(BigInt(claim.amount_base_units));

  let panel: React.ReactNode;
  switch (status) {
    case "created":
      panel = (
        <ClaimPanel state="valid" token={claim.token_prefix}>
          <ClaimForm token={token} amountUsdc={amountUsdc} />
        </ClaimPanel>
      );
      break;
    case "claimed":
      panel = (
        <ClaimPanel state="waiting-approval" token={claim.token_prefix}>
          <ClaimDetail label="Destination" value={claim.claimed_recipient ?? "—"} />
        </ClaimPanel>
      );
      break;
    case "approved":
      panel = (
        <ClaimPanel state="executing" token={claim.token_prefix}>
          <ClaimDetail label="Destination" value={claim.claimed_recipient ?? "—"} />
        </ClaimPanel>
      );
      break;
    case "executed":
      panel = (
        <ClaimPanel state="completed" token={claim.token_prefix}>
          <ClaimDetail label="Destination" value={claim.claimed_recipient ?? "—"} />
          <ExecutedProof claimId={claim.id} payoutId={claim.payout_id} />
        </ClaimPanel>
      );
      break;
    case "expired":
      panel = <ClaimPanel state="expired" token={claim.token_prefix} />;
      break;
    case "cancelled":
      panel = <ClaimPanel state="cancelled" token={claim.token_prefix} />;
      break;
    default:
      panel = <ClaimPanel state="used" token={claim.token_prefix} />;
  }

  return (
    <PageShell className="pt-10 md:pt-16">
      <div className="mx-auto w-full max-w-3xl">
        <ClaimSummary amountUsdc={amountUsdc} workspaceName={workspace.name ?? workspace.id} />
        {panel}
      </div>

      <section className="mx-auto mt-24 w-full max-w-3xl border-t border-line pt-10">
        <SectionLabel>How a claim works</SectionLabel>
        <h2 className="mt-5 font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          The destination appears before anything moves.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Submitting a wallet on this page only records the destination. The
          sender (or an approver) must approve the exact claimed address
          before Solvo simulates and executes through KeeperHub. This page can
          never move funds.
        </p>
      </section>
    </PageShell>
  );
}

function ClaimSummary({ amountUsdc, workspaceName }: { amountUsdc: string; workspaceName: string }) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-4">
      <div className="hairline-top pt-3">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Amount</p>
        <p className="mt-1 font-data text-[14px] leading-[1.3] tracking-[0.04em] text-primary">
          {amountUsdc} USDC
        </p>
      </div>
      <div className="hairline-top pt-3">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Network</p>
        <p className="mt-1 font-data text-[14px] leading-[1.3] tracking-[0.04em] text-primary">
          BASE · {workspaceName}
        </p>
      </div>
    </div>
  );
}

function ClaimDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="hairline-top mt-4 pt-4">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <p className="data-break mt-2 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">{value}</p>
    </div>
  );
}

async function ExecutedProof({ claimId, payoutId }: { claimId: string; payoutId: string | null }) {
  if (!payoutId) return null;
  const repo = getDbRepository();
  if (!repo) return null;
  const payout = await repo.getPayoutById(payoutId);
  const item = payout ? (await repo.getPayoutItemsByPayoutId(payoutId))[0] : null;
  if (!item?.transaction_hash) return null;
  void claimId;
  return (
    <div className="hairline-top mt-4 pt-4">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Proof</p>
      <p className="data-break mt-2 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">
        TX {item.transaction_hash}
      </p>
      <a
        href={`https://basescan.org/tx/${item.transaction_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary underline-offset-4 hover:underline"
      >
        View on BaseScan
      </a>
    </div>
  );
}

function ClaimExplanation() {
  return (
    <section className="mx-auto mt-24 w-full max-w-3xl border-t border-line pt-10">
      <SectionLabel>When a claim is connected</SectionLabel>
      <h2 className="mt-5 font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
        The destination appears before anything moves.
      </h2>
      <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
        A real claim experience prioritizes the amount, the token, the
        destination address input and explicit sender approval before money
        moves. The link remains single-use and expires after a fixed period.
      </p>
    </section>
  );
}
