import type { Metadata } from "next";
import { headers } from "next/headers";

import { SectionLabel } from "@/components/SectionLabel";
import { DashboardUnavailable } from "@/components/DashboardPanels";
import { requireDashboardPageContext } from "@/server/dashboard/page-gate";
import { buildRecipientsPageModel } from "@/server/dashboard/directory-page";
import { formatUtc } from "@/server/dashboard/overview-page";

export const metadata: Metadata = {
  title: "Recipients",
  description: "Solvo workspace recipient aliases: saved destinations, never money movement.",
};

export const dynamic = "force-dynamic";

/**
 * M12.7 — Recipients directory page.
 *
 * Read-only, workspace-scoped, session-gated. Rows render from the M12.2
 * recipient read model: full wallets for owners/approvers, masked for
 * members, and never any add/edit/delete surface. Saving an alias moves no
 * funds — the copy says so.
 */
export default async function RecipientsPage() {
  const page = await requireDashboardPageContext(await headers(), "recipients");
  if (!page.ok) return <DashboardUnavailable />;

  const model = await buildRecipientsPageModel(page.repo, page.ctx);
  if (!model.ok) return <DashboardUnavailable />;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header className="border-b border-line pb-7">
        <SectionLabel>Directory</SectionLabel>
        <h1 className="mt-3 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Recipients
        </h1>
        <p className="mt-3 max-w-2xl text-[12px] leading-[1.6] tracking-[0.05em] text-secondary">
          Recipients are saved aliases. Saving an alias does not move funds.
          Payments still require approval and KeeperHub execution.
        </p>
      </header>

      {model.empty ? (
        <p className="py-10 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">No recipients saved yet.</p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-xl border border-line bg-[#191919]">
          {model.items.map((item) => (
            <li key={item.recipientId} className="hairline-top px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="text-[13px] font-medium tracking-[0.05em] text-primary">{item.alias}</p>
                <p className="max-w-full break-all font-data text-[12px] tracking-[0.04em] text-secondary">{item.wallet}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-[11px] tracking-[0.06em] text-muted">
                  {item.createdByLabel !== null ? `Saved by ${item.createdByLabel}` : "Saved by an unknown member"}
                  {" · "}
                  {formatUtc(item.createdAt)}
                </p>
                <p className="font-data text-[11px] tracking-[0.05em] text-muted">
                  updated {formatUtc(item.updatedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
