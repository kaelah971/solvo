import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { requireDashboardPageContext } from "@/server/dashboard/page-gate";
import { buildBatchListPageModel } from "@/server/dashboard/payouts-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Batches",
  description: "Solvo workspace batch payouts: item totals and per-item completion state.",
};

export const dynamic = "force-dynamic";

/**
 * M12.5 — Batch list page.
 *
 * Read-only list of batch payouts only (batch sources). Counts are derived
 * from the payout items' pipeline states; proof chips never claim more than
 * the pipeline recorded.
 */
export default async function BatchesPage() {
  const page = await requireDashboardPageContext(await headers(), "batches");
  if (!page.ok) return <DashboardUnavailable />;

  const model = await buildBatchListPageModel(page.repo, page.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Requests</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Batches
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Multi-recipient payout requests. Each leg is tracked separately, and
          completion is confirmed only by the execution pipeline.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">No batch payouts yet.</p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <li key={item.view.payoutId} className="hairline-top px-5 py-4 transition-colors hover:bg-white/[0.025] sm:px-6">
              <Link
                href={`/app/batches/${item.view.payoutId}`}
                className="block transition-colors hover:opacity-80"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.shortId}
                    <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                      Batch payout
                    </span>
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-secondary">
                    {item.proofStatus.label}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.view.totalUsdc} {item.view.currency}
                  </p>
                  <p className="text-[11px] tracking-[0.06em] text-muted">
                    {item.view.itemCount} items ·{" "}
                    {item.completedCount} completed · {item.pendingCount} pending · {item.failedCount} failed or unknown
                  </p>
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                    {item.view.requesterLabel ?? "Unknown requester"} · {formatUtc(item.view.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
