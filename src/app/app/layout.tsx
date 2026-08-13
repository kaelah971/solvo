import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DashboardNav } from "@/components/DashboardNav";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: {
    default: "Operator Dashboard — Solvo",
    template: "%s — Solvo",
  },
  description:
    "Solvo workspace operator dashboard: approvals, payouts, claim links, members, and the audit trail.",
};

const DASHBOARD_SECTIONS = [
  { href: "/app", label: "Overview" },
  { href: "/app/approvals", label: "Approvals" },
  { href: "/app/payouts", label: "Payouts" },
  { href: "/app/batches", label: "Batches" },
  { href: "/app/claims", label: "Claims" },
  { href: "/app/recipients", label: "Recipients" },
  { href: "/app/members", label: "Members" },
  { href: "/app/policies", label: "Policies" },
  { href: "/app/agent-runs", label: "Agent Runs" },
  { href: "/app/audit", label: "Audit" },
] as const;

/**
 * M12.3/M12.10 — Operator dashboard shell.
 *
 * Slim operator chrome: wordmark + section navigation (only implemented
 * pages are linked) + sign out. Authentication is handled per-page through
 * the dashboard session seam — this layout renders no session data and leaks
 * nothing.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d0d0d] text-primary">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#121212]/95 backdrop-blur md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
          <div className="flex h-16 items-center justify-between px-5 md:h-auto md:px-7 md:pb-8 md:pt-8">
            <Link
              href="/app"
              className="flex items-baseline gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff6a00]"
            >
              <Wordmark />
              <span className="text-[9px] font-semibold uppercase leading-none tracking-[0.18em] text-muted md:hidden">
                Operator
              </span>
            </Link>
            <span className="hidden h-2 w-2 rounded-full bg-[#ff6a00] md:block" aria-hidden="true" />
          </div>
          <Suspense fallback={<div className="h-11 md:h-[calc(100vh-7rem)]" />}>
            <DashboardNav sections={DASHBOARD_SECTIONS} />
          </Suspense>
        </aside>

        <main className="min-w-0 flex-1 p-3 sm:p-5 lg:p-7">
          <div className="min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#151515] shadow-[0_24px_80px_rgba(0,0,0,0.32)] sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-3.5rem)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
