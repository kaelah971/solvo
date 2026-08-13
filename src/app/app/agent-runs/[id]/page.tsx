import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardNotFound, DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { AGENT_RUNS_TRUTH_NOTE, buildAgentRunDetailPageModel } from "@/server/dashboard/observability-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Agent run",
  description: "One Solvo agent request: interpretation, outcome, and links — observability only.",
};

export const dynamic = "force-dynamic";

/**
 * M12.9 — Agent run detail page.
 *
 * Read-only, observability only. Unknown or cross-workspace run ids render
 * the same generic not-found panel (no existence leak). Payout/claim links
 * appear only when the model verified the linked entity lives in this
 * workspace. This page never renders payment truth.
 */
export default async function AgentRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const { id } = await params;
  const model = await buildAgentRunDetailPageModel(repo, required.ctx, id);
  if (!model.ok) return <DashboardNotFound />;

  const { run } = model;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
        <Link href="/app/agent-runs" className="transition-colors hover:text-primary">
          Agent runs
        </Link>
      </p>
      <header className="mt-3 border-b border-line pb-7">
        <SectionLabel>Agent run</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          {model.decisionLabel}
        </h1>
        <p className="mt-3 font-data text-[12px] tracking-[0.05em] text-muted">{run.runId}</p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <DetailCell label="Status" value={model.statusLabel} />
        <DetailCell label="Surface" value={model.surfaceLabel} />
        <DetailCell label="PROVIDER" value={run.provider} />
        <DetailCell label="Interpreted kind" value={model.intentLabel} />
        <DetailCell label="Started" value={formatUtc(run.startedAt)} />
        <DetailCell
          label="Completed"
          value={run.completedAt !== null ? formatUtc(run.completedAt) : "Not yet"}
        />
        <DetailCell
          label="Linked payout"
          value={
            model.payoutLink !== null ? (
              <Link href={`/app/payouts/${model.payoutLink}`} className="underline-offset-4 hover:underline">
                {model.payoutLink.slice(0, 8)}
              </Link>
            ) : (
              "None"
            )
          }
        />
        <DetailCell
          label="Linked claim"
          value={
            model.claimLink !== null ? (
              <Link href={`/app/claims/${model.claimLink}`} className="underline-offset-4 hover:underline">
                {model.claimLink.slice(0, 8)}
              </Link>
            ) : (
              "None"
            )
          }
        />
      </section>

      <section className="mt-10">
        <SectionLabel>User request</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          {run.rawTextRedacted !== null ? (
            <p className="py-4 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">{run.rawTextRedacted}</p>
          ) : (
            <p className="py-4 text-[12px] leading-[1.5] tracking-[0.06em] text-muted">No redacted text stored.</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <SectionLabel>Outcome</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          {run.errorMessageRedacted !== null ? (
            <p className="py-4 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
              Error{run.errorCode !== null ? ` ${run.errorCode}` : ""}: {run.errorMessageRedacted}
            </p>
          ) : (
            <p className="py-4 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
              {model.decisionLabel}
            </p>
          )}
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
          Observability only.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          {AGENT_RUNS_TRUTH_NOTE}
        </p>
      </section>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-[#191919] px-5 py-5">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <div className="mt-2 font-data text-[12px] leading-[1.5] tracking-[0.04em] text-primary">{value}</div>
    </div>
  );
}
