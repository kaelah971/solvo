import type { Metadata } from "next";

import { ClaimPanel } from "@/components/ClaimPanel";
import { PageShell } from "@/components/PageShell";
import { SectionLabel } from "@/components/SectionLabel";
import { getDbRepository } from "@/server/db/accessor";
import { getClaimByRawToken } from "@/server/claim/service";
import { buildClaimStatusView } from "@/server/claim/status";
import { buildClaimWebPage } from "@/server/claim/web";
import { ClaimForm } from "./ClaimForm";

export const metadata: Metadata = {
  title: "Claim",
  description:
    "Claim a Solvo payment link. The destination address is supplied by the recipient and approved by the sender before anything moves through KeeperHub.",
};

export const dynamic = "force-dynamic";

/**
 * Claim page (M11.4). Read-only against the M11.2 read model: claim truth
 * comes from the claim row, completion/proof ONLY from the payout pipeline
 * via the status view. Submitting a wallet only records the destination; the
 * page can never approve, execute, or move funds, and never renders the raw
 * token, its hash, or its prefix.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const nowIso = new Date().toISOString();

  const repo = getDbRepository();

  // Unknown token (or unavailable DB): render the unavailable state
  // truthfully (no amount, no wallet, no workspace, no fabricated data).
  if (repo === null) {
    return (
      <PageShell className="pt-10 md:pt-16">
        <div className="mx-auto w-full max-w-3xl">
          <ClaimPanel state="unavailable" />
        </div>
        <ClaimExplanation />
      </PageShell>
    );
  }
  const lookup = await getClaimByRawToken(repo, token);
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
  let payout: Awaited<ReturnType<typeof repo.getPayoutById>> = null;
  let items: Awaited<ReturnType<typeof repo.getPayoutItemsByPayoutId>> = [];
  if (claim.payout_id !== null) {
    payout = await repo.getPayoutById(claim.payout_id);
    items = payout ? await repo.getPayoutItemsByPayoutId(payout.id) : [];
  }
  const view = buildClaimStatusView({ claim, nowIso, payout, items });
  const page = buildClaimWebPage(view);

  let panel: React.ReactNode;
  switch (page.state) {
    case "valid":
      panel = (
        <ClaimPanel state="valid">
          <ClaimForm token={token} amountUsdc={page.amountUsdc} />
        </ClaimPanel>
      );
      break;
    case "waiting-approval":
      panel = (
        <ClaimPanel state="waiting-approval">
          <ClaimDetail label="Destination" value={page.claimedWallet ?? "—"} />
        </ClaimPanel>
      );
      break;
    case "approved":
      panel = (
        <ClaimPanel state="approved">
          {page.claimedWallet !== null && <ClaimDetail label="Destination" value={page.claimedWallet} />}
          {page.payoutId !== null && <ClaimDetail label="Payment reference" value={page.payoutId} />}
        </ClaimPanel>
      );
      break;
    case "completed":
      panel = (
        <ClaimPanel state="completed">
          {page.claimedWallet !== null && <ClaimDetail label="Destination" value={page.claimedWallet} />}
          {page.payoutId !== null && <ClaimDetail label="Payment reference" value={page.payoutId} />}
          <ClaimProof txHash={page.txHash} txExplorerUrl={page.txExplorerUrl} />
        </ClaimPanel>
      );
      break;
    case "not-confirmed":
      panel = <ClaimPanel state="not-confirmed" />;
      break;
    case "expired":
      panel = <ClaimPanel state="expired" />;
      break;
    case "cancelled":
      panel = <ClaimPanel state="cancelled" />;
      break;
    default:
      panel = <ClaimPanel state="unavailable" />;
  }

  return (
    <PageShell className="pt-10 md:pt-16">
      <div className="mx-auto w-full max-w-3xl">
        <ClaimSummary
          amountUsdc={page.amountUsdc}
          workspaceName={workspace.name ?? workspace.id}
          expiresAt={page.expiresAt}
        />
        {panel}
      </div>

      <section className="content-panel mx-auto mt-8 w-full max-w-3xl rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
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

function ClaimSummary({
  amountUsdc,
  workspaceName,
  expiresAt,
}: {
  amountUsdc: string;
  workspaceName: string;
  expiresAt: string;
}) {
  return (
    <div className="content-panel mb-4 grid grid-cols-1 overflow-hidden rounded-[24px] border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-line">
      <div className="border-b border-line p-5 sm:border-b-0">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Amount</p>
        <p className="mt-1 font-data text-[14px] leading-[1.3] tracking-[0.04em] text-primary">
          {amountUsdc} USDC
        </p>
      </div>
      <div className="border-b border-line p-5 sm:border-b-0">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Network</p>
        <p className="mt-1 font-data text-[14px] leading-[1.3] tracking-[0.04em] text-primary">
          BASE · {workspaceName}
        </p>
      </div>
      <div className="p-5">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Expires</p>
        <p className="mt-1 font-data text-[14px] leading-[1.3] tracking-[0.04em] text-primary">
          {expiresAt.replace("T", " ").slice(0, 19)} UTC
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

/**
 * Completion proof. Rendered ONLY in the `completed` panel, which the page
 * shows only when the M11.2 view carries a pipeline-confirmed hash — so this
 * component never receives (and can never invent) a hash.
 */
function ClaimProof({ txHash, txExplorerUrl }: { txHash: string | null; txExplorerUrl: string | null }) {
  if (txHash === null) return null;
  return (
    <div className="hairline-top mt-4 pt-4">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">Proof</p>
      <p className="data-break mt-2 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">
        TX {txHash}
      </p>
      {txExplorerUrl !== null && (
        <a
          href={txExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary underline-offset-4 hover:underline"
        >
          View on BaseScan
        </a>
      )}
    </div>
  );
}

function ClaimExplanation() {
  return (
    <section className="content-panel mx-auto mt-8 w-full max-w-3xl rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
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
