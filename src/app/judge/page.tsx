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
    "A restricted Telegram-based execution environment for authorized hackathon judges. This page is informational only.",
};

const judgeRequirements = [
  {
    label: "Dedicated workspace",
    body: "Judge Mode runs in a dedicated Solvo workspace. The wallet is the configured KeeperHub org wallet; a separate judge wallet is not integrated yet.",
  },
  {
    label: "Telegram allowlist",
    body: "Judges are allowlisted by Telegram numeric ID (TELEGRAM_JUDGE_USER_IDS). Only allowlisted accounts can run judge commands.",
  },
  {
    label: "Automatic approval",
    body: "Approval is automatic within strict caps: 0.10 USDC per transaction and 1.00 USDC per day.",
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
      <header className="mt-14 md:mt-20">
        <SectionLabel>Judge demo</SectionLabel>
        <StatusLabel
          label="Restricted execution environment"
          tone="pending"
          className="mt-3 block"
        />
      </header>

      <div className="mt-10 max-w-3xl">
        <StatePanel
          badge="ACCESS RESTRICTED"
          tone="pending"
          headline="Judge access is granted via the Telegram allowlist."
          body="Judge Mode is a restricted Telegram-based execution environment for authorized hackathon judges. Access is granted through the Telegram bot allowlist, and this page is informational only — it can never execute or move funds."
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

      <section className="mt-16 max-w-3xl">
        <SectionLabel>Judge environment</SectionLabel>
        <h2 className="mt-5 max-w-xl text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary md:text-2xl">
          How restricted judge execution works.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Judge Mode is not public and not a sandbox. Authorized judges run real
          transactions through the Telegram bot with the /judgepay
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
          description="Judge Mode is not a sandbox and not public: allowlisted judges move real funds through the Telegram bot. This page cannot execute a transaction and exists for information only."
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
