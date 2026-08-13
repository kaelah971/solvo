import type { Metadata } from "next";
import { headers } from "next/headers";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import {
  agentRunDecisionLabel,
  agentRunStatusLabel,
  auditEventLabel,
  buildOverviewPageModel,
  formatUtc,
  type OverviewPageModel,
} from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "Solvo workspace overview: pending approvals, claim links, prepared and completed totals, and recent activity.",
};

export const dynamic = "force-dynamic";

/**
 * M12.3 — Overview page.
 *
 * Server-rendered, read-only. Identity comes from the dashboard session seam
 * (cookie-only, never query params) and ACTIVE same-workspace membership is
 * re-checked from the repository on every request. Every number renders from
 * the M12.2 overview read model: prepared is not paid, completed comes only
 * from the execution pipeline, agent requests are observability only, and
 * nothing on this page approves or executes.
 */
export default async function OverviewPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildOverviewPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return <OverviewDashboard model={model} />;
}

function OverviewDashboard({ model }: { model: Extract<OverviewPageModel, { ok: true }> }) {
  const { overview } = model;
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
      <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-b border-line pb-6">
        <div>
          <SectionLabel>Workspace</SectionLabel>
          <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
            {model.workspaceLabel}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {model.modeLabel !== null && <Badge label={`${model.modeLabel} MODE`} />}
          <Badge label={model.roleLabel} />
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending approvals"
          value={String(overview.pendingApprovals)}
          note="Waiting for an owner or approver. No funds have moved."
        />
        <StatCard
          label="Claim links waiting"
          value={String(overview.pendingClaimLinks)}
          note="Awaiting a recipient wallet."
        />
        <StatCard
          label="Claimed, waiting approval"
          value={String(overview.claimedWaitingApproval)}
          note="Wallet entry moved no funds."
        />
        <StatCard
          label="Prepared today"
          value={`${overview.preparedTodayUsdc} USDC`}
          note="Prepared does not mean paid."
        />
        <StatCard
          label="Completed today"
          value={`${overview.completedTodayUsdc} USDC · ${overview.completedToday}`}
          note="Completed totals come from the execution pipeline."
        />
        <StatCard
          label="Failed or unknown"
          value={String(overview.failedOrUnknown)}
          note="Unknown is not proof. Check the audit trail."
        />
        <StatCard label="Active members" value={String(overview.activeMembers)} note="Active workspace members." />
        <StatCard label="Recipients" value={String(overview.recipientCount)} note="Registered aliases." />
      </section>

      {overview.claimCountCapped && (
        <p className="mt-4 text-[11px] leading-[1.5] tracking-[0.08em] text-muted">
          Claim counts are capped at the read limit and are a lower bound.
        </p>
      )}

      <section className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <RecentActivity
          title="Recent audit events"
          body={
            overview.recentAuditEvents.length === 0
              ? "No audit events yet."
              : undefined
          }
        >
          {overview.recentAuditEvents.map((event) => (
            <ActivityRow
              key={event.eventId}
              label={auditEventLabel(event.eventType)}
              meta={`${formatUtc(event.createdAt)}${event.actorMaskedId !== null ? ` · ${event.actorMaskedId}` : ""}`}
            />
          ))}
        </RecentActivity>
        <RecentActivity
          title="Recent agent requests"
          body={
            overview.recentAgentRuns.length === 0
              ? "No agent requests yet."
              : undefined
          }
          note="Agent requests are observability only. They never move funds."
        >
          {overview.recentAgentRuns.map((run) => (
            <ActivityRow
              key={run.runId}
              label={`${agentRunStatusLabel(run.status)} · ${agentRunDecisionLabel(run.decisionType)}`}
              meta={formatUtc(run.startedAt)}
            />
          ))}
        </RecentActivity>
      </section>

      <section className="mt-14 border-t border-line pt-8">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
          KeeperHub execution happens only after approval.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Nothing on this dashboard moves funds. Prepared means a request is
          waiting; completed means the execution pipeline confirmed it.
        </p>
      </section>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="border border-border px-3 py-1.5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-secondary">
      {label}
    </span>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-void px-5 py-6">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-3 font-data text-[22px] leading-[1.2] tracking-[0.03em] text-primary">{value}</p>
      <p className="mt-3 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">{note}</p>
    </div>
  );
}

function RecentActivity({
  title,
  body,
  note,
  children,
}: {
  title: string;
  body?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      {note && <p className="mt-2 text-[11px] leading-[1.5] tracking-[0.08em] text-muted">{note}</p>}
      <div className="hairline-top mt-5">
        {body !== undefined ? (
          <p className="py-5 text-[12px] leading-[1.5] tracking-[0.06em] text-secondary">{body}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ActivityRow({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="hairline-top flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
      <p className="text-[12px] leading-[1.4] tracking-[0.05em] text-primary">{label}</p>
      <p className="font-data text-[11px] leading-[1.4] tracking-[0.05em] text-muted">{meta}</p>
    </div>
  );
}
