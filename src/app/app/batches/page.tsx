import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
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
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildBatchListPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
      <header className="border-b border-line pb-6">
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
        <ul className="mt-6">
          {model.items.map((item) => (
            <li key={item.view.payoutId} className="hairline-top py-4">
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
