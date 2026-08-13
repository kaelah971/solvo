import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { requireDashboardPageContext } from "@/server/dashboard/page-gate";
import { buildAgentRunListPageModel } from "@/server/dashboard/observability-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Agent runs",
  description: "Solvo agent request observability: how a request was interpreted, never payment proof.",
};

export const dynamic = "force-dynamic";

/**
 * M12.9 — Agent runs list page.
 *
 * Read-only, workspace-scoped, session-gated, observability only. Every row
 * renders from the M12.2 agent-run view: redacted text, status/intent/
 * decision labels, provider label, and safe error summaries. Never provider
 * JSON and never payment truth.
 */
export default async function AgentRunsPage() {
  const page = await requireDashboardPageContext(await headers(), "agent-runs");
  if (!page.ok) return <DashboardUnavailable />;

  const model = await buildAgentRunListPageModel(page.repo, page.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Observability</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Agent runs
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Agent runs explain how Solvo interpreted a request. Agent runs are
          not payment proof. Payment truth comes from payouts, claim links,
          and execution pipeline rows.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          No agent requests recorded yet.
        </p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <li key={item.view.runId} className="hairline-top px-5 py-4 transition-colors hover:bg-white/[0.025] sm:px-6">
              <Link
                href={`/app/agent-runs/${item.view.runId}`}
                className="block transition-colors hover:opacity-80"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.shortId}
                    <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                      {item.surfaceLabel} · {item.statusLabel}
                    </span>
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-secondary">
                    {item.decisionLabel}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <p className="text-[11px] tracking-[0.06em] text-muted">
                    {item.intentLabel} · PROVIDER {item.view.provider}
                  </p>
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">{formatUtc(item.view.startedAt)}</p>
                  {item.view.linkedPayoutId !== null && (
                    <p className="text-[11px] tracking-[0.06em] text-muted">
                      payout {item.view.linkedPayoutId.slice(0, 8)}
                    </p>
                  )}
                  {item.view.linkedClaimId !== null && (
                    <p className="text-[11px] tracking-[0.06em] text-muted">
                      claim {item.view.linkedClaimId.slice(0, 8)}
                    </p>
                  )}
                </div>
                {item.view.rawTextRedacted !== null && (
                  <p className="mt-2 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">
                    {item.view.rawTextRedacted}
                  </p>
                )}
                {item.view.errorMessageRedacted !== null && (
                  <p className="mt-1 text-[11px] leading-[1.5] tracking-[0.06em] text-secondary">
                    Error: {item.view.errorMessageRedacted}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
