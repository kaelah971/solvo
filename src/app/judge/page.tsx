import type { Metadata } from "next";
import Link from "next/link";

import { Cta } from "@/components/Cta";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { SectionLabel } from "@/components/SectionLabel";
import { StatePanel } from "@/components/StatePanel";
import { StatusLabel } from "@/components/StatusLabel";

export const metadata: Metadata = {
  title: "Judge demo",
  description:
    "Self-serve public judge execution: open the Solvo Telegram bot and complete one tiny real Base USDC payment under strict caps. This page is informational only.",
};

const judgeRequirements = [
  {
    label: "Self-serve public",
    body: "Open @SolvoAgentBot and send /judgepay <address> <amount> USDC. No allowlist and no contact with the project owner is required.",
  },
  {
    label: "Strict caps",
    body: "0.01 USDC per transaction, 0.25 USDC per day, 1.00 USDC lifetime, and one successful payment per Telegram user.",
  },
  {
    label: "Admin override",
    body: "Operators may set TELEGRAM_JUDGE_USER_IDS to lock Judge Mode down to specific admin accounts; empty means public self-serve.",
  },
  {
    label: "Base USDC only",
    body: "Judge transactions settle on Base mainnet in USDC only.",
  },
  {
    label: "Full logging",
    body: "Every real judge transaction returns its execution ID, transaction hash, BaseScan link, amount, recipient and status — all persisted and auditable.",
  },
] as const;

export default function JudgePage() {
  return (
    <PageShell>
      <header className="page-hero mt-10 rounded-[32px] border border-border bg-surface px-6 py-10 sm:px-10 sm:py-14 md:mt-16">
        <SectionLabel>Judge demo</SectionLabel>
        <StatusLabel
          label="Self-serve public execution environment"
          tone="pending"
          className="mt-3 block"
        />
      </header>

      <div className="mt-10 max-w-3xl">
        <StatePanel
          badge="PUBLIC · REAL · CAPPED"
          tone="pending"
          headline="Judge Mode is public, real, and tightly capped."
          body="Judge Mode is a self-serve public real-execution boundary: any Telegram user can complete one tiny real Base USDC payment via /judgepay with no project-owner involvement. It is not a sandbox — real funds move. This page is informational only and can never execute or move funds."
        >
          <div>
            <Cta
              disabled
              title="Judge execution runs through the Telegram bot; this page cannot execute"
            >
              Judge execution via Telegram
            </Cta>
            <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
              Available after configuration.
            </p>
          </div>
        </StatePanel>
      </div>

      <section className="content-panel mt-8 max-w-3xl rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Judge environment</SectionLabel>
        <h2 className="mt-5 max-w-xl text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary md:text-2xl">
          How self-serve judge execution works.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Judge Mode is public, real execution under strict abuse limits — not
          a sandbox, and never a public path for /pay or /batch. Anyone runs
          real transactions through the Telegram bot with the /judgepay
          &lt;address&gt; &lt;amount&gt; USDC command, governed by these rules:
        </p>
        <ul className="mt-8">
          {judgeRequirements.map((item) => (
            <li
              key={item.label}
              className="hairline-top grid grid-cols-1 gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6"
            >
              <h3 className="text-[12px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary">
                {item.label}
              </h3>
              <p className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-16 max-w-3xl">
        <EmptyState
          label="INFORMATIONAL ONLY"
          description="Judge Mode moves real Base USDC for any Telegram user via /judgepay, one successful payment per user, capped at 0.01 USDC per transaction. This page cannot execute a transaction and exists for information only."
        />
      </div>

      <div className="mt-10">
        <Link
          href="/sandbox"
          className="text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] text-muted transition-colors hover:text-primary"
        >
          ← Return to sandbox
        </Link>
      </div>
    </PageShell>
  );
}
