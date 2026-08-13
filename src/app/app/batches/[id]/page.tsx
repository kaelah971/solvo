import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardNotFound, DashboardUnavailable } from "@/components/DashboardPanels";
import { requireDashboardPageContext } from "@/server/dashboard/page-gate";
import { buildBatchDetailPageModel } from "@/server/dashboard/payouts-page";
import { auditEventLabel, formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Batch",
  description: "One Solvo batch payout: per-recipient legs, states, and pipeline proof.",
};

export const dynamic = "force-dynamic";

/**
 * M12.5 — Batch detail page.
 *
 * Read-only. Only batch-source payouts render here; non-batch payouts and
 * unknown/cross-workspace ids all show the same generic not-found panel.
 * Per-leg proof appears only where a completed leg carries a pipeline
 * transaction hash. No approve, reject, or retry controls exist on this page.
 */
export default async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requireDashboardPageContext(await headers(), "batch-detail");
  if (!page.ok) return <DashboardUnavailable />;

  const { id } = await params;
  const model = await buildBatchDetailPageModel(page.repo, page.ctx, id);
  if (!model.ok) return <DashboardNotFound />;

  const { detail } = model;
  const completedCount = detail.items.filter((item) => item.state === "completed").length;
  const failedCount = detail.items.filter((item) =>
    ["validation_failed", "simulation_failed", "execution_failed", "execution_unknown"].includes(item.state),
  ).length;
  const pendingCount = detail.items.filter((item) => item.state === "pending_approval").length;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
        <Link href="/app/batches" className="transition-colors hover:text-primary">
          Batches
        </Link>
      </p>
      <header className="mt-3 border-b border-line pb-7">
        <SectionLabel>Batch payout</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Batch payout
        </h1>
        <p className="mt-3 font-data text-[12px] tracking-[0.05em] text-muted">{detail.payoutId}</p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <BatchCell label="Status" value={detail.stateLabel} />
        <BatchCell label="Requester" value={detail.requesterLabel ?? "Unknown requester"} />
        <BatchCell label="Total" value={`${detail.totalUsdc} ${detail.currency}`} />
        <BatchCell label="Items" value={String(detail.itemCount)} />
        <BatchCell label="Completed" value={String(completedCount)} />
        <BatchCell label="Pending" value={String(pendingCount)} />
        <BatchCell label="Failed or unknown" value={String(failedCount)} />
        <BatchCell label="Created" value={formatUtc(detail.createdAt)} />
      </section>

      <section className="mt-12">
        <SectionLabel>Recipients</SectionLabel>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-[#191919] px-5">
          {detail.items.length === 0 ? (
            <p className="py-5 text-[12px] leading-[1.5] tracking-[0.06em] text-secondary">No recipients recorded.</p>
          ) : (
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
                  <th className="py-3 pr-4 font-semibold">Recipient</th>
                  <th className="py-3 pr-4 font-semibold">Amount</th>
                  <th className="py-3 pr-4 font-semibold">State</th>
                  <th className="py-3 font-semibold">Proof</th>
                </tr>
              </thead>
              <tbody className="hairline-top">
                {detail.items.map((item) => (
                  <tr key={item.itemId} className="hairline-top align-top">
                    <td className="py-3 pr-4 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-primary">
                      {item.recipient}
                    </td>
                    <td className="py-3 pr-4 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-primary">
                      {item.amountUsdc} USDC
                    </td>
                    <td className="py-3 pr-4 text-[11px] leading-[1.5] tracking-[0.05em] text-secondary">
                      {item.stateLabel}
                    </td>
                    <td className="py-3 text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">
                      {item.txHash !== null && item.txExplorerUrl !== null ? (
                        <a
                          href={item.txExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-data text-primary underline-offset-4 hover:underline"
                        >
                          TX {item.txHash}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          Approved does not mean executed.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Completed proof appears only when the execution pipeline recorded a
          transaction. This page has no approve, reject, or retry controls.
        </p>
      </section>
    </div>
  );
}

function BatchCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#191919] px-5 py-5">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-2 font-data text-[12px] leading-[1.5] tracking-[0.04em] text-primary">{value}</p>
    </div>
  );
}
