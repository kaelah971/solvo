import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { getDbRepository } from "@/server/db/accessor";
import { requireDashboardContext } from "@/server/dashboard/session";
import { resolveDashboardPageGate } from "@/server/dashboard/page-gate";
import { buildClaimListPageModel } from "@/server/dashboard/claims-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Claims",
  description: "Solvo workspace claim links: effective status, amounts, and pipeline proof state.",
};

export const dynamic = "force-dynamic";

/**
 * M12.6 — Claim links list page.
 *
 * Read-only, workspace-scoped, session-gated. Every row renders from the
 * M12.2 claim read model through the gated page model: no fabricated rows,
 * effective statuses follow the M11.2 rules (expiry computed, claimed
 * preserved, completed only with pipeline proof), wallets are masked, and
 * no raw claim token, hash, or prefix ever renders. Reissue eligibility is
 * display-only — there is no reissue action.
 */
export default async function ClaimsPage() {
  const gate = resolveDashboardPageGate(await headers());
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return <DashboardUnavailable />;

  const required = await requireDashboardContext({ repo, session: gate.session, nowIso: gate.nowIso });
  if (!required.ok) return <DashboardUnavailable />;

  const model = await buildClaimListPageModel(repo, required.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
      <header className="border-b border-line pb-6">
        <SectionLabel>Links</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Claim links
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Every claim link in this workspace. Entering a wallet never moves
          funds, expiry is computed, and completion appears only when the
          execution pipeline recorded a transaction.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">No claim links yet.</p>
      ) : (
        <ul className="mt-6">
          {model.items.map((item) => (
            <li key={item.view.claimId} className="hairline-top py-4">
              <Link
                href={`/app/claims/${item.view.claimId}`}
                className="block transition-colors hover:opacity-80"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.shortId}
                    <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">
                      {item.statusLabel}
                    </span>
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-secondary">
                    {item.proofLabel}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <p className="font-data text-[13px] tracking-[0.04em] text-primary">
                    {item.view.amountUsdc} {item.view.currency} · {item.view.network}
                  </p>
                  <p className="text-[11px] tracking-[0.06em] text-muted">
                    expires {formatUtc(item.view.expiresAt)}
                  </p>
                  {item.view.maskedWallet !== null && (
                    <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                      claimed · {item.view.maskedWallet}
                    </p>
                  )}
                  {item.payoutState !== null && (
                    <p className="text-[11px] tracking-[0.06em] text-muted">
                      payout · {item.payoutState}
                    </p>
                  )}
                  <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                    {item.view.requesterLabel ?? "Unknown requester"} · {formatUtc(item.view.createdAt)}
                  </p>
                </div>
                <div className="mt-1.5">
                  <p
                    className={
                      item.reissue.eligible
                        ? "text-[11px] font-semibold uppercase tracking-[0.15em] text-secondary"
                        : "text-[11px] tracking-[0.06em] text-muted"
                    }
                  >
                    {item.reissue.label}
                  </p>
                  {!item.reissue.eligible && item.reissue.reason !== null && (
                    <p className="mt-0.5 text-[11px] leading-[1.5] tracking-[0.06em] text-muted">
                      {item.reissue.reason}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
