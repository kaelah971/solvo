import type { Metadata } from "next";

import { BatchSummary } from "@/components/BatchSummary";
import { Cta } from "@/components/Cta";
import { PageShell } from "@/components/PageShell";
import { PolicyRow } from "@/components/PolicyRow";
import { SectionLabel } from "@/components/SectionLabel";
import { TelegramCta } from "@/components/TelegramCta";

export const metadata: Metadata = {
  title: "Community treasury execution",
  description:
    "Solvo validates every row of a community payout, routes approval to the right treasury role and reports the result recipient by recipient.",
};

const treasurerFlow = [
  {
    index: "01",
    title: "Upload the list once",
    body: "A member uploads the payout CSV into the workspace. The file is read once; every row becomes a payment request.",
  },
  {
    index: "02",
    title: "Validate every row",
    body: "Headers, addresses, amounts and duplicates are checked before any approval is requested.",
  },
  {
    index: "03",
    title: "Route approval",
    body: "Approval is routed to the treasury role allowed by policy — never to the person who created the payout.",
  },
  {
    index: "04",
    title: "Report results",
    body: "The outcome is reported recipient by recipient, followed by the final summary and audit record.",
  },
] as const;

const validationChecks = [
  {
    label: "Address checksum",
    body: "Every destination is checked for EVM format and checksum before it can be paid.",
  },
  {
    label: "Positive amounts",
    body: "Zero and negative values are rejected.",
  },
  {
    label: "CSV headers",
    body: "The file must carry the expected columns before rows are read.",
  },
  {
    label: "Every row validated",
    body: "A single bad row is identified before the batch can move.",
  },
  {
    label: "Duplicate detection",
    body: "Recipients are compared across the batch; repeated destinations are flagged.",
  },
  {
    label: "Workspace limits",
    body: "Per-payment and daily workspace limits apply to the whole batch.",
  },
] as const;

const roles = [
  {
    title: "Owner",
    body: "Manages the workspace and its policies.",
  },
  {
    title: "Approver",
    body: "Approves restricted payouts.",
  },
  {
    title: "Member",
    body: "Creates payment requests.",
  },
] as const;

export default function CommunityPage() {
  return (
    <PageShell className="pt-10 md:pt-16">
      <section className="page-hero rounded-[32px] border border-border bg-surface px-6 py-12 sm:px-10 sm:py-16">
        <SectionLabel>Community workspace</SectionLabel>
        <h1 className="mt-5 max-w-2xl font-display text-3xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-4xl">
          Community treasury execution
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Contributor payouts, rewards, reimbursements and grants — executed
          from the group conversation, validated before movement and reported
          recipient by recipient.
        </p>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>The treasurer&apos;s flow</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Four steps from CSV to completed batch.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Upload the list once. Solvo validates every row, routes approval to
          the right treasury role and reports the result recipient by
          recipient.
        </p>
        <div className="mt-8 max-w-3xl overflow-hidden rounded-[20px] border border-line px-5">
          {treasurerFlow.map((step) => (
            <PolicyRow key={step.index} index={step.index} title={step.title}>
              {step.body}
            </PolicyRow>
          ))}
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Validation before movement</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Nothing moves until every row is checked.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Bad data is caught before money moves — not after. Bulk work does not
          mean blind work.
        </p>
        <ul className="mt-8 max-w-2xl">
          {validationChecks.map((check, index) => (
            <li
              key={check.label}
              className={`grid grid-cols-1 gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6 ${
                index > 0 ? "hairline-top" : ""
              }`}
            >
              <span className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
                {check.label}
              </span>
              <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                {check.body}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Workspace roles</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Approval authority is separate from request authority.
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-3">
          {roles.map((role) => (
            <div key={role.title} className="rounded-[20px] border border-line bg-black/10 p-6">
              <h3 className="text-[12px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary">
                {role.title}
              </h3>
              <p className="mt-3 text-[12px] leading-[1.6] tracking-[0.05em] text-muted">
                {role.body}
              </p>
            </div>
          ))}
        </div>
        <p className="hairline-top mt-8 max-w-2xl pt-5 text-[13px] leading-[1.6] tracking-[0.05em] text-primary">
          The person who creates a large payout must not automatically be able
          to approve it.
        </p>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Approval preview</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          The summary comes before the approval.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          A treasurer must understand the batch risk — recipients, total,
          validity, duplicates and the required approver — before releasing
          funds.
        </p>
        <div className="mt-8 max-w-2xl">
          <BatchSummary />
          <p className="mt-4 text-[12px] leading-[1.6] tracking-[0.08em] text-muted">
            A real payout summary appears here after validation — before
            approval, never after.
          </p>
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Auditability</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Every payment leaves a record.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Every real payment produces a recipient-level outcome and an audit
          record — who requested it, who approved it, what was simulated, what
          executed and what completed. Nothing is called complete until the
          execution state supports it.
        </p>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-12 sm:px-10">
        <h2 className="max-w-lg font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Upload once. Approve once. Account for everything.
        </h2>
        <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <TelegramCta />
          <Cta href="/how-it-works">See the execution path</Cta>
        </div>
      </section>
    </PageShell>
  );
}
