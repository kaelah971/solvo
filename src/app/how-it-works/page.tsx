import type { Metadata } from "next";

import { ExecutionLine } from "@/components/ExecutionLine";
import { PageShell } from "@/components/PageShell";
import { PolicyRow } from "@/components/PolicyRow";
import { SectionLabel } from "@/components/SectionLabel";

export const metadata: Metadata = {
  title: "How the execution agent works",
  description:
    "How Solvo turns a Telegram payment instruction into a validated, approved, simulated, executed and auditable USDC transaction through KeeperHub.",
};

const loopSteps = [
  {
    index: "01",
    title: "Interpret",
    body: "Natural language arrives as payment intent — for example, “Send Alex 5 USDC.” Interpretation describes the desired outcome; it never overrides financial policy.",
  },
  {
    index: "02",
    title: "Check",
    body: "The recipient, amount, token and network are validated. Workspace state and remaining limits are inspected before anything proceeds.",
  },
  {
    index: "03",
    title: "Decide",
    body: "Deterministic spending and authorization policies determine whether automatic execution is permitted or human approval is required. Approval is routed when necessary.",
  },
  {
    index: "04",
    title: "Simulate",
    body: "The transfer is simulated through KeeperHub before any broadcast. A failed simulation stops the flow — nothing is submitted.",
  },
  {
    index: "05",
    title: "Execute",
    body: "The approved instruction is submitted through KeeperHub with an idempotency key, so a repeated submission cannot double-send. Execution status is polled.",
  },
  {
    index: "06",
    title: "Observe",
    body: "Execution state is tracked until a terminal outcome. Pending states remain visible with written labels.",
  },
  {
    index: "07",
    title: "Recover or escalate",
    body: "Only safe transient failures — timeouts and temporary service errors — are retried. Invalid addresses, invalid amounts, failed simulations, rejected approvals and policy violations are never auto-retried. They stop or escalate to review.",
  },
  {
    index: "08",
    title: "Prove",
    body: "The execution receipt and audit proof are produced. The transaction hash and audit record are the completion state.",
  },
] as const;

const agenticMoments = [
  "Interpret",
  "Decide",
  "Observe",
  "Classify",
  "Escalate",
] as const;

const guardrails = [
  "Validation",
  "Limits",
  "Authorization",
  "Idempotency",
  "Safe retry classification",
] as const;

const stateLanguage = [
  "Simulation complete. No funds were moved.",
  "Approval required.",
  "Execution is confirming.",
  "Payment completed.",
  "Review required.",
  "Transaction proof available.",
] as const;

export default function HowItWorksPage() {
  return (
    <PageShell className="pt-10 md:pt-16">
      <section>
        <SectionLabel>The execution agent</SectionLabel>
        <h1 className="mt-5 max-w-2xl font-display text-3xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-4xl">
          How the execution agent works
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Solvo takes a payment instruction from Telegram and resolves it into
          a validated, approved, simulated, executed and auditable USDC
          transaction through KeeperHub.
        </p>
      </section>

      <section className="mt-24 border-t border-line pt-10">
        <SectionLabel>The agent loop</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          One continuous sequence from instruction to proof.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Every payment request passes through the same eight stages. The
          sequence does not skip validation, approval or simulation.
        </p>
        <div className="mt-8 max-w-3xl">
          {loopSteps.map((step) => (
            <PolicyRow key={step.index} index={step.index} title={step.title}>
              {step.body}
            </PolicyRow>
          ))}
        </div>
      </section>

      <section className="mt-24 border-t border-line pt-10">
        <SectionLabel>Where agency lives</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Agentic moments sit inside deterministic guardrails.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          The agent works in the stages where judgment is required. The
          guardrails around them are fixed and cannot be negotiated in natural
          language.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-[12px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary">
              Agentic moments
            </h3>
            <p className="mt-3 text-[12px] leading-[1.6] tracking-[0.05em] text-muted">
              The agent interprets intent, decides the path, observes state,
              classifies outcomes and escalates what needs a person.
            </p>
            <ul className="mt-5">
              {agenticMoments.map((item, index) => (
                <li
                  key={item}
                  className={`flex items-baseline gap-4 py-3 ${
                    index > 0 ? "hairline-top" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="shrink-0 font-data text-[11px] tracking-[0.08em] text-faint"
                  >
                    ·
                  </span>
                  <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[12px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary">
              Deterministic guardrails
            </h3>
            <p className="mt-3 text-[12px] leading-[1.6] tracking-[0.05em] text-muted">
              Validation, limits, authorization, idempotency and retry
              classification are fixed rules that every request must pass.
            </p>
            <ul className="mt-5">
              {guardrails.map((item, index) => (
                <li
                  key={item}
                  className={`flex items-baseline gap-4 py-3 ${
                    index > 0 ? "hairline-top" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="shrink-0 font-data text-[11px] tracking-[0.08em] text-faint"
                  >
                    ·
                  </span>
                  <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-10 max-w-2xl border-t border-line pt-5 text-[13px] leading-[1.6] tracking-[0.05em] text-primary">
          Natural language never overrides policy. It can only describe the
          outcome within it.
        </p>
      </section>

      <section className="mt-24 border-t border-line pt-10">
        <SectionLabel>State language</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Fixed phrases. No ambiguity.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Every state announcement uses one of these exact strings. Simulation
          and real execution are never worded the same.
        </p>
        <ul className="mt-8 max-w-2xl">
          {stateLanguage.map((phrase, index) => (
            <li
              key={phrase}
              className={`flex items-baseline gap-4 py-3 ${
                index > 0 ? "hairline-top" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="shrink-0 font-data text-[11px] tracking-[0.08em] text-faint"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="font-data text-[12px] leading-[1.5] tracking-[0.05em] text-secondary">
                {phrase}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-24 border-t border-line pt-10">
        <SectionLabel>The Execution Line</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          One line, five real states.
        </h2>
        <div className="mt-8 flex flex-wrap">
          <ExecutionLine
            stages={[
              { label: "Request", status: "pending" },
              { label: "Check", status: "pending" },
              { label: "Approve", status: "pending" },
              { label: "Execute", status: "pending" },
              { label: "Prove", status: "pending" },
            ]}
            announce="The Solvo execution line: request, check, approve, execute, prove."
          />
        </div>
        <p className="mt-4 max-w-md text-[12px] leading-[1.5] tracking-[0.05em] text-muted">
          Every stage is a real product state — not a decorative progress bar.
          Each one is backed by persisted execution data and shown with a
          written label.
        </p>
      </section>
    </PageShell>
  );
}
