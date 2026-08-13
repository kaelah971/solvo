import type { Metadata } from "next";
import { headers } from "next/headers";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildPolicyPageModel } from "@/server/dashboard/policies-page";

export const metadata: Metadata = {
  title: "Policies",
  description: "Solvo workspace safety policy: limits, mode, and approval requirements — read only.",
};

export const dynamic = "force-dynamic";

/**
 * M12.8 — Policies page.
 *
 * Read-only, workspace-scoped, session-gated. Displays only what the
 * workspace row actually stores (mode, limits, approval policy, status)
 * plus a truthful spent/remaining-today budget. No edit buttons, no forms,
 * no server actions — policies cannot be changed from this page.
 */
export default async function PoliciesPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildPolicyPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Safety</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Policies
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Policies explain what Solvo will allow. This page does not change
          them. Approval and execution still happen through the existing
          Solvo pipeline.
        </p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <PolicyCell label="Workspace" value={model.workspaceLabel} />
        <PolicyCell label="Mode" value={model.modeLabel} />
        <PolicyCell label="Status" value={model.statusLabel} />
        <PolicyCell label="Token / network" value={model.networkLabel} />
      </section>

      <section className="mt-12">
        <SectionLabel>Payment safety</SectionLabel>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          <PolicyRow
            label="Per-transaction limit"
            value={model.perTransactionLimitUsdc !== null ? `${model.perTransactionLimitUsdc} USDC` : "Not configured"}
          />
          <PolicyRow
            label="Daily limit"
            value={model.dailyLimitUsdc !== null ? `${model.dailyLimitUsdc} USDC` : "Not configured"}
          />
          <PolicyRow label="Spent today" value={`${model.spentTodayUsdc} USDC`} />
          <PolicyRow
            label="Remaining today"
            value={
              model.remainingTodayUsdc !== null
                ? `${model.remainingTodayUsdc} USDC`
                : "No daily limit configured"
            }
          />
          <PolicyRow
            label="Approval requirement"
            value={model.approvalPolicyLabel}
            note={approvalNote(model.approvalPolicyLabel)}
          />
        </div>
        <p className="mt-4 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">
          Separation of duty is enforced server-side: requesters cannot
          approve their own payout.
        </p>
      </section>

      {model.modeNote !== null && (
        <section className="mt-12">
          <SectionLabel>Mode note</SectionLabel>
          <p className="mt-4 rounded-xl border border-line bg-[#191919] px-5 py-4 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
            {model.modeNote}
          </p>
        </section>
      )}

      <section className="mt-12">
        <SectionLabel>Claim-link safety</SectionLabel>
        <ul className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919] px-5">
          <ClaimNote>Wallet entered does not mean funds moved.</ClaimNote>
          <ClaimNote>Claim approval prepares a payment; it does not execute one by itself.</ClaimNote>
          <ClaimNote>Raw claim links are shown once and cannot be redisplayed.</ClaimNote>
          <ClaimNote>Reissue action is not enabled from the dashboard yet.</ClaimNote>
        </ul>
      </section>

      <section className="mt-12">
        <SectionLabel>Dashboard actions</SectionLabel>
        <div className="mt-4 rounded-xl border border-line bg-[#191919] px-5">
          <p className="py-4 text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
            This page is read-only. Editing limits and policies is not enabled
            yet, and policy changes will be audited when enabled later.
          </p>
        </div>
      </section>

      <section className="mt-12">
        <SectionLabel>Your access</SectionLabel>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-line bg-[#191919] px-5 py-4">
          <p className="text-[12px] leading-[1.5] tracking-[0.05em] text-primary">{model.capability.summary}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
            {model.capability.roleLabel}
          </p>
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
          KeeperHub execution happens only after approval.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Nothing on this page moves funds, and nothing here can change what
          the workspace will allow.
        </p>
      </section>
    </div>
  );
}

function approvalNote(label: string): string {
  switch (label) {
    case "REQUIRED":
      return "Every payment needs an owner or approver before anything moves.";
    case "JUDGE POLICY":
      return "Judge Mode applies its own execution policy via /judgepay.";
    default:
      return "No approval policy is configured.";
  }
}

function PolicyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#191919] px-5 py-5">
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-2 font-data text-[12px] leading-[1.5] tracking-[0.04em] text-primary">{value}</p>
    </div>
  );
}

function PolicyRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="hairline-top flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
      <div>
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">{label}</p>
        {note !== undefined && (
          <p className="mt-1 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">{note}</p>
        )}
      </div>
      <p className="font-data text-[12px] leading-[1.4] tracking-[0.04em] text-primary">{value}</p>
    </div>
  );
}

function ClaimNote({ children }: { children: React.ReactNode }) {
  return (
    <li className="hairline-top py-3 text-[12px] leading-[1.5] tracking-[0.05em] text-secondary">{children}</li>
  );
}
