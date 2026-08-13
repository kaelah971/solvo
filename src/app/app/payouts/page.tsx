import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildPayoutListPageModel } from "@/server/dashboard/payouts-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Payouts",
  description: "Solvo workspace payout requests: state, proof status, and request metadata.",
};

export const dynamic = "force-dynamic";

/**
 * M12.5 — Payout list page.
 *
 * Read-only, workspace-scoped, session-gated. Every row renders from the
 * M12.2 read model through the gated page model: no fabricated rows, proof
 * chips come from `payoutProofStatus` (pipeline truth only), and there are no
 * action buttons.
 */
export default async function PayoutsPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildPayoutListPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Requests</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Payouts
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Every payout request in this workspace. Approved does not mean
          executed, and proof appears only when the execution pipeline
          recorded a transaction.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          No payout requests yet.
        </p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <li key={item.view.payoutId} className="hairline-top px-5 py-4 transition-colors hover:bg-white/[0.025] sm:px-6">
              <Link
                href={`/app/payouts/${item.view.payoutId}`}
                className="block transition-colors hover:opacity-80"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.shortId}
                    <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                      {item.sourceLabel}
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
                    {item.view.itemCount} item{item.view.itemCount === 1 ? "" : "s"} ·{" "}
                    {item.view.requesterLabel ?? "Unknown requester"}
                    {item.decisionLabel !== null ? ` · ${item.decisionLabel}` : ""}
                  </p>
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                    {formatUtc(item.view.createdAt)}
                    {item.view.completedAt !== null ? ` · completed ${formatUtc(item.view.completedAt)}` : ""}
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
