import type { Metadata } from "next";

import { Cta } from "@/components/Cta";
import { PageShell } from "@/components/PageShell";
import { PaymentPreview } from "@/components/PaymentPreview";
import { PolicyRow } from "@/components/PolicyRow";
import { SectionLabel } from "@/components/SectionLabel";
import { TelegramCta } from "@/components/TelegramCta";

export const metadata: Metadata = {
  title: "Payments for individuals",
  description:
    "Direct address payments and claim links from Telegram — the destination is always shown and approved before anything moves.",
};

const directSteps = [
  {
    index: "01",
    title: "Instruction in Telegram",
    body: "A payment starts with an instruction in the conversation: a destination address and an amount.",
  },
  {
    index: "02",
    title: "Validation",
    body: "The address, checksum, amount, token and network are validated before anything proceeds.",
  },
  {
    index: "03",
    title: "Destination shown",
    body: "The exact destination appears before approval. It is never hidden behind clever copy.",
  },
  {
    index: "04",
    title: "Simulation",
    body: "The transfer is simulated through KeeperHub before any broadcast.",
  },
  {
    index: "05",
    title: "Execution",
    body: "An approved request is submitted through KeeperHub with an idempotency key.",
  },
  {
    index: "06",
    title: "Receipt",
    body: "The transaction hash and audit record return to the chat when execution completes.",
  },
] as const;

const claimSteps = [
  {
    index: "01",
    title: "Sender creates the link",
    body: "The sender sets an amount without needing the recipient's wallet address.",
  },
  {
    index: "02",
    title: "Recipient enters the address",
    body: "The recipient opens the claim page in a browser and enters their own destination.",
  },
  {
    index: "03",
    title: "Solvo shows the sender",
    body: "The exact claimed destination is shown to the sender.",
  },
  {
    index: "04",
    title: "Sender approves",
    body: "The sender approves the final address before anything moves.",
  },
  {
    index: "05",
    title: "Single use, fixed expiry",
    body: "A claim link can be used once and expires after a fixed period.",
  },
] as const;

const securityNotes = [
  "Telegram usernames are never treated as wallet identities.",
  "The destination address is validated before approval.",
  "Claim links cannot be reused or redirected.",
] as const;

export default function IndividualsPage() {
  return (
    <PageShell className="pt-10 md:pt-16">
      <section className="page-hero rounded-[32px] border border-border bg-surface px-6 py-12 sm:px-10 sm:py-16">
        <SectionLabel>Personal workspace</SectionLabel>
        <h1 className="mt-5 max-w-2xl font-display text-3xl font-medium leading-[1.1] tracking-[-0.01em] text-primary md:text-4xl">
          Payments for individuals
        </h1>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          Send USDC from the conversation — not from a maze of wallet screens.
          The destination is always shown before anything moves.
        </p>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Direct payments</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          An explicit address, validated and shown.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          A direct payment names the destination up front. Solvo checks it,
          shows it, simulates it and then executes it.
        </p>
        <div className="mt-8 max-w-3xl overflow-hidden rounded-[20px] border border-line px-5">
          {directSteps.map((step) => (
            <PolicyRow key={step.index} index={step.index} title={step.title}>
              {step.body}
            </PolicyRow>
          ))}
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Claim links</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          The recipient supplies the destination.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          A claim link lets the sender pay the right person without guessing a
          wallet address. The sender still approves the final destination
          before money moves.
        </p>
        <div className="mt-8 max-w-3xl overflow-hidden rounded-[20px] border border-line px-5">
          {claimSteps.map((step) => (
            <PolicyRow key={step.index} index={step.index} title={step.title}>
              {step.body}
            </PolicyRow>
          ))}
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Before approval</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          The preview is the checkpoint.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          The destination and amount appear before the approval actions. The
          irreversible moment is never hidden.
        </p>
        <div className="mt-8 max-w-2xl">
          <PaymentPreview />
        </div>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>Security notes</SectionLabel>
        <h2 className="mt-5 max-w-xl font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Identity is never guessed.
        </h2>
        <ul className="mt-8 max-w-2xl">
          {securityNotes.map((note, index) => (
            <li
              key={note}
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
                {note}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="content-panel mt-8 rounded-[28px] border border-border bg-surface px-6 py-12 sm:px-10">
        <h2 className="max-w-lg font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          Request it in chat.
          <br />
          Prove it onchain.
        </h2>
        <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <TelegramCta />
          <Cta href="/community">Community treasury</Cta>
        </div>
      </section>
    </PageShell>
  );
}
