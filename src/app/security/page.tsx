import type { Metadata } from "next";

import { Cta } from "@/components/Cta";
import { PageShell } from "@/components/PageShell";
import { PolicyRow } from "@/components/PolicyRow";
import { SectionLabel } from "@/components/SectionLabel";
import { TelegramCta } from "@/components/TelegramCta";

export const metadata: Metadata = {
  title: "The trust model",
  description:
    "How Solvo keeps funds safe: policy before movement, validation, deterministic authorization, simulation, spending limits, idempotency, safe retries, proof and an isolated judge environment.",
};

const sectionHeading =
  "mt-5 max-w-xl text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary md:text-2xl";

const sectionBody =
  "mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary";

export default function SecurityPage() {
  return (
    <PageShell>
      <header className="mt-14 md:mt-20">
        <SectionLabel>Security</SectionLabel>
        <h1 className="mt-4 font-display text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-3xl">
          The trust model.
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Solvo exists to make value movement accountable. The claims below are
          rules the system follows — every one of them runs before value moves.
        </p>
      </header>

      <section className="mt-16">
        <SectionLabel>Before anything moves</SectionLabel>
        <h2 className={sectionHeading}>Checks run before value can move.</h2>
        <p className={sectionBody}>
          A payment instruction never reaches the network on its own. It passes
          validation, authorization and simulation first — in that order.
        </p>
        <div className="mt-8">
          <PolicyRow index="01" title="Policy before movement">
            <p>
              Every check runs before anything can move. An instruction never
              reaches KeeperHub until validation, authorization and simulation
              have all passed.
            </p>
          </PolicyRow>
          <PolicyRow index="02" title="Validation">
            <p>
              Destinations are checked for EVM address format and checksum.
              Amounts must be positive USDC. The chain and token must be
              supported. Batch files are validated at the header and at every
              row, and duplicate recipients are detected before anything is
              queued.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Authorization</SectionLabel>
        <h2 className={sectionHeading}>
          Authority is deterministic, not conversational.
        </h2>
        <p className={sectionBody}>
          Natural language can request a payment. It can never override roles,
          limits or approval rules — every authority decision is made on the
          server.
        </p>
        <div className="mt-8">
          <PolicyRow index="03" title="Deterministic authorization">
            <p>
              Workspace roles — owner, approver, member — are enforced
              server-side, never in the client. A request creator cannot
              approve a restricted payout, and all approval authority is
              validated before a callback is honoured.
            </p>
          </PolicyRow>
          <PolicyRow index="06" title="Workspace roles">
            <p>
              The owner manages the workspace and its policies. The approver
              approves restricted payouts. Members create requests. Roles are
              stored as Telegram numeric IDs and never inferred from
              usernames.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Execution</SectionLabel>
        <h2 className={sectionHeading}>
          Simulation before broadcast. Proof after.
        </h2>
        <p className={sectionBody}>
          An approved instruction is simulated through KeeperHub before it is
          submitted. Only classified transient failures may ever be retried.
        </p>
        <div className="mt-8">
          <PolicyRow index="04" title="Simulation before submission">
            <p>
              The transfer is checked through KeeperHub before it is
              broadcast. A failed simulation stops the flow: nothing is
              submitted and nothing moves.
            </p>
          </PolicyRow>
          <PolicyRow index="05" title="Spending limits">
            <p>
              Every request is checked against the per-payment limit and the
              daily workspace limit — before approval and again before
              execution.
            </p>
          </PolicyRow>
          <PolicyRow index="07" title="Idempotency">
            <p>
              Every submission carries an idempotency key. Duplicate callbacks
              and repeated attempts cannot double-execute a payout.
            </p>
          </PolicyRow>
          <PolicyRow index="08" title="Safe retries only">
            <p>
              Retries are limited to classified transient failures — timeouts
              and temporary service errors. Invalid addresses, invalid
              amounts, failed simulations, rejected approvals and policy
              violations are never retried automatically.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Proof</SectionLabel>
        <h2 className={sectionHeading}>
          No payment is complete until it is proved.
        </h2>
        <p className={sectionBody}>
          Completion is a data state, not a turn of phrase. A receipt exists
          only when KeeperHub returned evidence.
        </p>
        <div className="mt-8">
          <PolicyRow index="09" title="Proof after execution">
            <p>
              Every real transaction returns a transaction hash, an execution
              ID and an audit record. No payment is complete until it is
              proved.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Judge environment</SectionLabel>
        <h2 className={sectionHeading}>
          A separate, strictly capped environment.
        </h2>
        <p className={sectionBody}>
          The judge demo runs in its own workspace with its own wallet and its
          own rules — never alongside sandbox or community funds.
        </p>
        <div className="mt-8">
          <PolicyRow index="10" title="Isolated judge environment">
            <p>
              The judge demo uses a dedicated wallet, a Telegram allowlist and
              automatic approval within strict caps: max 0.10 USDC per
              transaction, max 1 USDC per day, Base USDC only. Sandbox users
              cannot access judge funds.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Credentials</SectionLabel>
        <h2 className={sectionHeading}>Secrets never leave the server.</h2>
        <p className={sectionBody}>
          Credentials and claim tokens are handled so that exposure in chat or
          the browser is impossible by design.
        </p>
        <div className="mt-8">
          <PolicyRow index="11" title="Credentials kept server-side">
            <p>
              KeeperHub credentials never appear in Telegram or the browser.
              Claim tokens are stored hashed, never raw, and secrets are
              redacted from logs.
            </p>
          </PolicyRow>
        </div>
      </section>

      <section className="mt-16">
        <SectionLabel>Truthful states</SectionLabel>
        <h2 className={sectionHeading}>The interface never overclaims.</h2>
        <p className={sectionBody}>
          Every state shown to a user must survive inspection. Simulation,
          terminology and failure copy all follow the same rule.
        </p>
        <ul className="mt-8 max-w-xl">
          <li className="hairline-top flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
            <span className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted sm:w-[160px]">
              Simulation
            </span>
            <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
              Simulated results always state “No funds were moved.”
            </span>
          </li>
          <li className="hairline-top flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
            <span className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted sm:w-[160px]">
              Terminology
            </span>
            <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
              A simulation is never called a transaction.
            </span>
          </li>
          <li className="hairline-top flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
            <span className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted sm:w-[160px]">
              Failures
            </span>
            <span className="text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
              Failures are explicit: they name what failed, state whether
              funds moved and explain the next safe action.
            </span>
          </li>
        </ul>
      </section>

      <section className="mt-16 flex flex-col items-start gap-6 md:flex-row md:items-center">
        <TelegramCta />
        <Cta href="/how-it-works">See the execution path</Cta>
      </section>
    </PageShell>
  );
}
