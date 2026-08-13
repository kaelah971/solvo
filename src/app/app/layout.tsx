import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: {
    default: "Operator Dashboard — Solvo",
    template: "%s — Solvo",
  },
  description:
    "Solvo workspace operator dashboard: approvals, payouts, claim links, members, and the audit trail.",
};

/**
 * M12.3 — Operator dashboard shell.
 *
 * Slim operator chrome (no marketing nav/footer): wordmark + section label,
 * then the page. Authentication is handled per-page through the dashboard
 * session seam — this layout renders no session data and leaks nothing.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-substrate min-h-screen">
      <div className="site-inner flex min-h-screen flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
            <Link href="/app" className="flex items-baseline gap-4">
              <Wordmark />
              <span className="hidden text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted sm:inline">
                Operator Dashboard
              </span>
            </Link>
            <Link
              href="/"
              className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-muted transition-colors hover:text-primary"
            >
              Solvo site
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
