import type { Metadata } from "next";
import { headers } from "next/headers";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { requireDashboardPageContext } from "@/server/dashboard/page-gate";
import { buildAuditPageModel } from "@/server/dashboard/observability-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Audit",
  description: "Solvo workspace audit timeline: what was recorded, never payment proof by itself.",
};

export const dynamic = "force-dynamic";

/**
 * M12.9 — Audit timeline page.
 *
 * Read-only, workspace-scoped, session-gated. Every row renders from the
 * M12.2 audit view: event label, source family, masked actor, safe entity
 * reference, whitelisted metadata summary, timestamp. Raw metadata blobs
 * and tokens never render.
 */
export default async function AuditPage() {
  const page = await requireDashboardPageContext(await headers(), "audit");
  if (!page.ok) return <DashboardUnavailable />;

  const model = await buildAuditPageModel(page.repo, page.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Timeline</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Audit
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Audit events show what Solvo recorded. Audit events do not create
          payment proof by themselves. Payment proof appears only when the
          execution pipeline recorded a transaction.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          No audit events recorded yet.
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <div key={item.view.eventId} className="hairline-top px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="text-[13px] font-medium tracking-[0.05em] text-primary">{item.eventLabel}</p>
                <div className="flex flex-wrap items-baseline gap-x-4">
                  {item.view.actorMaskedId !== null && (
                    <p className="text-[11px] tracking-[0.06em] text-muted">{item.view.actorMaskedId}</p>
                  )}
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">{formatUtc(item.view.createdAt)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                  {item.sourceLabel}
                </span>
                {item.entityLabel !== null && (
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">{item.entityLabel}</p>
                )}
                {item.summaryLabel !== null && (
                  <p className="text-[11px] leading-[1.5] tracking-[0.06em] text-secondary">{item.summaryLabel}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
