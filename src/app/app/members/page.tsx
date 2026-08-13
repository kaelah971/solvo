import type { Metadata } from "next";
import { headers } from "next/headers";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildMembersPageModel } from "@/server/dashboard/directory-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Members",
  description: "Solvo workspace members: roles, status, and joined dates.",
};

export const dynamic = "force-dynamic";

/**
 * M12.7 — Members directory page.
 *
 * Read-only, workspace-scoped, session-gated. Rows render from the M12.2
 * member read model with masked identities, role labels, and status labels.
 * There is no add/remove/change-role surface on this page — changing roles
 * is not enabled from the dashboard yet.
 */
export default async function MembersPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildMembersPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Directory</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Members
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Roles control what people can request, approve, and manage.
          Separation of duty is enforced server-side: requesters cannot
          approve their own payout. Changing roles is not enabled from the
          dashboard yet.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          No members recorded in this workspace.
        </p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <li key={item.view.memberId} className="hairline-top px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="text-[13px] font-medium tracking-[0.05em] text-primary">{item.view.maskedId}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border bg-white/[0.025] px-3 py-1.5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.16em] text-secondary">
                    {item.roleLabel}
                  </span>
                  <span className="rounded-full border border-border bg-white/[0.025] px-3 py-1.5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.16em] text-muted">
                    {item.statusLabel}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-[11px] tracking-[0.06em] text-muted">joined {formatUtc(item.view.createdAt)}</p>
                <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                  updated {formatUtc(item.view.updatedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
