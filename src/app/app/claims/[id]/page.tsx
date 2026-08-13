import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardNotFound, DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildClaimDetailPageModel } from "@/server/dashboard/claims-page";
import { auditEventLabel, formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Claim link",
  description: "One Solvo claim link: effective status, masked wallet, pipeline proof, and the audit trail.",
};

export const dynamic = "force-dynamic";

/**
 * M12.6 — Claim detail page.
 *
 * Read-only. Unknown or cross-workspace claim ids render the same generic
 * not-found panel (no existence leak). Pipeline proof (tx hash + explorer
 * link) renders ONLY when the M11.2 status view reports a completed pipeline
 * item carrying a transaction hash — never invented, never upgraded. Reissue
 * eligibility is display-only; no action exists on this page.
 */
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const { id } = await params;
  const model = await buildClaimDetailPageModel(repo, required.ctx, id);
  if (!model.ok) return <DashboardNotFound />;

  const { detail } = model;
  const statusView = detail.statusView;
  const requester = detail.requesterLabel ?? "Unknown requester";

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
        <Link href="/app/claims" className="transition-colors hover:text-primary">
          Claim links
        </Link>
      </p>
      <header className="mt-3 border-b border-line pb-7">
        <SectionLabel>Claim link</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          {model.statusLabel}
        </h1>
        <p className="mt-3 font-data text-[12px] tracking-[0.05em] text-muted">{detail.claimId}</p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <DetailCell label="Status" value={model.proofLabel} />
        <DetailCell label="Amount" value={`${detail.amountUsdc} ${detail.currency}`} />
        <DetailCell label="Network" value={detail.network} />
        <DetailCell label="Expires" value={formatUtc(detail.expiresAt)} />
        <DetailCell label="Claimed wallet" value={detail.maskedWallet ?? "None entered yet"} />
        <DetailCell label="Created" value={formatUtc(detail.createdAt)} />
        <DetailCell label="Requester" value={requester} />
        <DetailCell
          label="Linked payout"
          value={
            statusView.payoutState !== null
              ? `${detail.payoutId ?? "Linked"} · ${statusView.payoutState}`
              : "None"
          }
        />
      </section>

      <section className="mt-10 max-w-2xl rounded-xl border border-line bg-[#191919] p-5">
        <SectionLabel>What this status means</SectionLabel>
        <p className="mt-3 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">{statusView.safetyNote}</p>
        {statusView.claimedAt !== null && (
          <p className="mt-2 font-data text-[11px] tracking-[0.05em] text-muted">
            Wallet entered {formatUtc(statusView.claimedAt)}
          </p>
        )}
      </section>

      <section className="mt-10">
        <SectionLabel>Proof</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          {statusView.txHash !== null && statusView.txExplorerUrl !== null ? (
            <p className="py-4 text-[12px] leading-[1.5] tracking-[0.05em] text-secondary">
              Completed through the execution pipeline.{" "}
              <a
                href={statusView.txExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-data text-primary underline-offset-4 hover:underline"
              >
                TX {statusView.txHash}
              </a>
            </p>
          ) : (
            <p className="py-4 text-[12px] leading-[1.5] tracking-[0.06em] text-muted">
              No pipeline transaction proof to show.
            </p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <SectionLabel>Reissue</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          {model.reissue.eligible ? (
            <>
              <p className="py-4 text-[12px] leading-[1.5] tracking-[0.05em] text-secondary">
                {model.reissue.label}.
              </p>
              <p className="pb-4 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">
                Reissue action will be enabled after the claim reissue
                migration is applied and admin actions are wired.
              </p>
            </>
          ) : (
            <p className="py-4 text-[12px] leading-[1.5] tracking-[0.06em] text-muted">
              {model.reissue.label}.
              {model.reissue.reason !== null ? ` ${model.reissue.reason}` : ""}
            </p>
          )}
        </div>
      </section>

      <section className="mt-12">
        <SectionLabel>Audit trail</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          {detail.auditTimeline.length === 0 ? (
            <p className="py-5 text-[12px] leading-[1.5] tracking-[0.06em] text-secondary">No audit events recorded.</p>
          ) : (
            detail.auditTimeline.map((event) => (
              <div key={event.eventId} className="hairline-top flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <p className="text-[12px] leading-[1.4] tracking-[0.05em] text-primary">
                  {auditEventLabel(event.eventType)}
                  {event.actorMaskedId !== null ? ` · ${event.actorMaskedId}` : ""}
                </p>
                <p className="font-data text-[11px] leading-[1.4] tracking-[0.05em] text-muted">
                  {formatUtc(event.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
          Wallet entered does not mean funds moved.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Claim approval prepares a payment; it does not execute one by itself.
          Completed proof appears only when the execution pipeline recorded a
          transaction. Raw claim links are shown once and cannot be
          redisplayed.
        </p>
      </section>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#191919] px-5 py-5">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-2 break-words font-data text-[12px] leading-[1.5] tracking-[0.04em] text-primary">{value}</p>
    </div>
  );
}
