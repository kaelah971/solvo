import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildApprovalsPageModel, selfRequesterNote } from "@/server/dashboard/approvals-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Approvals",
  description: "Solvo approval queue: pending payouts, batches, and claimed claim links — read only.",
};

export const dynamic = "force-dynamic";

/**
 * M12.10 — Approvals queue page.
 *
 * Read-only, workspace-scoped, session-gated. Renders the pending decision
 * queue — single payouts, batch payouts, and claimed claim links — from the
 * M12.2 read models. No approve/reject/execute/reissue controls exist on
 * this page; approving does not execute funds by itself.
 */
export default async function ApprovalsPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildApprovalsPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Queue</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Approvals
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          This queue shows requests waiting for a human decision. Approving
          does not execute funds by itself.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-line bg-[#191919] px-5 py-4">
        <p className="text-[12px] leading-[1.5] tracking-[0.05em] text-primary">{model.capability.copy}</p>
        <p className="text-[11px] leading-[1.5] tracking-[0.06em] text-muted">
          Requesters cannot approve their own payout.
        </p>
      </div>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">No pending approvals.</p>
      ) : (
        <>
          {model.payouts.length > 0 && (
            <section className="mt-10">
              <SectionLabel>Payouts waiting</SectionLabel>
              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919]">
                {model.payouts.map((item) => (
                  <QueueRow key={item.payoutId}>
                    <Link href={`/app/payouts/${item.payoutId}`} className="block transition-colors hover:opacity-80">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.shortId}
                          <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                            {item.sourceLabel}
                          </span>
                        </p>
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.totalUsdc} {item.currency}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                        <p className="text-[11px] tracking-[0.06em] text-muted">
                          {item.itemCount} item{item.itemCount === 1 ? "" : "s"} ·{" "}
                          {item.requesterLabel ?? "Unknown requester"} · {formatUtc(item.createdAt)}
                        </p>
                      </div>
                    </Link>
                    {item.requesterIsSelf && <SelfNote>{selfRequesterNote("payout")}</SelfNote>}
                  </QueueRow>
                ))}
              </div>
            </section>
          )}

          {model.batches.length > 0 && (
            <section className="mt-12">
              <SectionLabel>Batches waiting</SectionLabel>
              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919]">
                {model.batches.map((item) => (
                  <QueueRow key={item.payoutId}>
                    <Link href={`/app/batches/${item.payoutId}`} className="block transition-colors hover:opacity-80">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.shortId}
                          <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                            Batch payout
                          </span>
                        </p>
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.totalUsdc} {item.currency}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                        <p className="text-[11px] tracking-[0.06em] text-muted">
                          {item.itemCount} items · {item.completedCount} completed · {item.pendingCount} pending ·{" "}
                          {item.failedCount} failed or unknown
                        </p>
                        <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                          {item.requesterLabel ?? "Unknown requester"} · {formatUtc(item.createdAt)}
                        </p>
                      </div>
                    </Link>
                    {item.requesterIsSelf && <SelfNote>{selfRequesterNote("payout")}</SelfNote>}
                  </QueueRow>
                ))}
              </div>
            </section>
          )}

          {model.claims.length > 0 && (
            <section className="mt-12">
              <SectionLabel>Claimed claims waiting</SectionLabel>
              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#191919]">
                {model.claims.map((item) => (
                  <QueueRow key={item.claimId}>
                    <Link href={`/app/claims/${item.claimId}`} className="block transition-colors hover:opacity-80">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.shortId}
                          <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                            Claimed, waiting approval
                          </span>
                        </p>
                        <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                          {item.amountUsdc} {item.currency} · {item.network}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                        <p className="text-[11px] tracking-[0.06em] text-muted">
                          expires {formatUtc(item.expiresAt)}
                        </p>
                        {item.maskedWallet !== null && (
                          <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                            claimed · {item.maskedWallet}
                          </p>
                        )}
                        {item.payoutId !== null && (
                          <p className="text-[11px] tracking-[0.06em] text-muted">
                            payout · {item.payoutId.slice(0, 8)}
                          </p>
                        )}
                        <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                          {item.requesterLabel ?? "Unknown requester"} · {formatUtc(item.createdAt)}
                        </p>
                      </div>
                    </Link>
                    {item.requesterIsSelf && <SelfNote>{selfRequesterNote("claim")}</SelfNote>}
                  </QueueRow>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted">
          KeeperHub execution happens only after approval and the existing
          execution pipeline.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Nothing on this page approves, rejects, executes, or reissues.
        </p>
      </section>
    </div>
  );
}

function QueueRow({ children }: { children: React.ReactNode }) {
  return <div className="hairline-top px-5 py-4 transition-colors hover:bg-white/[0.025]">{children}</div>;
}

function SelfNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[11px] leading-[1.5] tracking-[0.06em] text-secondary">{children}</p>
  );
}
