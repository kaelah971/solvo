import type { Metadata } from "next";

import { AgentChecks } from "@/components/AgentChecks";
import { Cta } from "@/components/Cta";
import { EmptyState } from "@/components/EmptyState";
import { ExecutionLine } from "@/components/ExecutionLine";
import { ExecutionReceipt } from "@/components/ExecutionReceipt";
import { PageShell } from "@/components/PageShell";
import { SectionLabel } from "@/components/SectionLabel";
import { StatusLabel } from "@/components/StatusLabel";

export const metadata: Metadata = {
  title: "Public sandbox",
  description:
    "Try the Solvo validation experience with simulated payments only. No real KeeperHub credentials and no real funds are used.",
};

const sectionHeading =
  "mt-5 max-w-xl text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary md:text-2xl";

export default function SandboxPage() {
  return (
    <PageShell>
      <header className="page-hero mt-10 rounded-[32px] border border-border bg-surface px-6 py-10 sm:px-10 sm:py-14 md:mt-16">
        <div className="rounded-[20px] border border-line bg-black/15 px-6 py-6">
          <div className="flex flex-col gap-3">
            <SectionLabel>Sandbox</SectionLabel>
            <StatusLabel label="Simulation only" tone="pending" className="text-[13px]" />
            <StatusLabel
              label="No funds will move"
              tone="pending"
              className="text-[13px]"
            />
          </div>
        </div>
        <h1 className="mt-10 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          Public sandbox
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          The sandbox demonstrates the full validation experience with
          simulated payments only. No real KeeperHub credentials and no real
          funds are used.
        </p>
      </header>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Payment instruction</SectionLabel>
        <h2 className={sectionHeading}>Submit a simulated payment.</h2>
        <div className="mt-8 max-w-xl">
          <textarea
            disabled
            aria-disabled="true"
            aria-label="Payment instruction"
            placeholder="Waiting for a payment instruction"
            className="min-h-28 w-full resize-none rounded-[16px] border border-border bg-black/20 px-4 py-3 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-70"
          />
          <div className="mt-4">
            <Cta disabled title="The sandbox backend is not connected">
              Submit simulation
            </Cta>
          </div>
          <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
            Simulation is unavailable until the sandbox backend is connected.
          </p>
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Agent checks</SectionLabel>
        <h2 className={sectionHeading}>The agent shows its working.</h2>
        <div className="mt-8 max-w-xl">
          <AgentChecks
            items={[]}
            emptyLabel="Waiting for a payment instruction"
            emptyDescription="Checks appear here: destination, amount, token, policy, simulation — each with a written state word."
          />
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Policy result</SectionLabel>
        <h2 className={sectionHeading}>Policy evaluation.</h2>
        <div className="mt-8 max-w-xl">
          <EmptyState
            label="NO POLICY RESULT"
            description="Policy evaluation appears here when a simulation runs."
          />
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Execution line</SectionLabel>
        <h2 className={sectionHeading}>The simulated path.</h2>
        <div className="mt-8 max-w-xl">
          <ExecutionLine
            stages={[
              { label: "Request", status: "pending" },
              { label: "Check", status: "pending" },
              { label: "Approve", status: "pending" },
              { label: "Execute", status: "pending" },
              { label: "Prove", status: "pending" },
            ]}
            announce="Sandbox execution line. No funds will move."
          />
          <div className="mt-4">
            <StatusLabel label="Simulation only — no funds will move" tone="pending" />
          </div>
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Simulation receipt</SectionLabel>
        <h2 className={sectionHeading}>The simulated receipt.</h2>
        <div className="mt-8 max-w-2xl">
          <ExecutionReceipt
            reference="—"
            fields={[
              { label: "Requested by", value: "—" },
              { label: "Recipient", value: "—" },
              { label: "Amount", value: "—" },
              { label: "Network", value: "—" },
              { label: "Simulation", value: "—", mono: true },
              { label: "Transaction hash", value: "—", mono: true },
              { label: "Audit", value: "—" },
            ]}
            status={{ label: "SIMULATION UNAVAILABLE", tone: "pending" }}
          />
          <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
            Simulated results always state that no funds were moved.
          </p>
        </div>
      </section>

      <p className="hairline-top mt-16 pt-6 text-[12px] leading-[1.5] tracking-[0.05em] text-muted">
        The sandbox cannot access the judge environment or any real funds.
      </p>
    </PageShell>
  );
}
