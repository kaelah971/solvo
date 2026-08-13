import type { Metadata } from "next";

import { AgentChecks } from "@/components/AgentChecks";
import { Cta } from "@/components/Cta";
import { ExecutionLine } from "@/components/ExecutionLine";
import { ExecutionReceipt } from "@/components/ExecutionReceipt";
import { ExecutionStrip } from "@/components/ExecutionStrip";
import { Footer } from "@/components/Footer";
import { GhostWordmark } from "@/components/GhostWordmark";
import { HeroTypingWordmark } from "@/components/HeroTypingWordmark";
import { Lamp } from "@/components/Lamp";
import { SectionLabel } from "@/components/SectionLabel";
import { SiteNav } from "@/components/SiteNav";
import { TelegramCta } from "@/components/TelegramCta";

export const metadata: Metadata = {
  title: "From instruction to execution",
  description:
    "Solvo turns Telegram payment instructions into safe, reliable, auditable USDC transactions.",
};

export default function Home() {
  return (
    <div className="site-substrate min-h-screen">
      <div className="site-inner">
        <SiteNav />

        <main>
          <section className="landing-hero relative flex min-h-[calc(100svh-84px)] flex-col">
            <div className="hero-arrow left-0" aria-hidden="true">
              ←
            </div>
            <div className="hero-arrow right-0" aria-hidden="true">
              →
            </div>

            <div className="hero-stage relative flex flex-1 items-start justify-center text-center">
              <h1 className="sr-only">Solvo</h1>
              <div className="hero-enter hero-lamp" aria-hidden="true">
                <Lamp className="lamp-breathe block h-auto w-full" />
              </div>
              <div className="hero-word-stack flex flex-col items-center">
                <div className="hero-wordmark-lockup hero-enter relative">
                  <HeroTypingWordmark />
                  <GhostWordmark className="mt-[clamp(0.55rem,1.4vw,0.9rem)] whitespace-nowrap [@media(max-height:500px)_and_(min-width:640px)]:!mt-1" />
                </div>
                <div className="hero-enter-delayed relative z-10 flex flex-col items-center">
                  <p className="mt-3 max-w-[420px] text-[12px] leading-[1.6] tracking-[0.05em] text-secondary sm:text-[13px] [@media(max-height:500px)_and_(min-width:640px)]:!mt-2 [@media(max-height:500px)_and_(min-width:640px)]:!max-w-[360px] [@media(max-height:500px)_and_(min-width:640px)]:!text-[10px] [@media(max-height:500px)_and_(min-width:640px)]:!leading-[1.4]">
                    Telegram payment coordination with KeeperHub-backed proof.
                  </p>
                  <div className="hero-telegram-action mt-5">
                    <TelegramCta
                      label="Open Solvo in Telegram"
                      variant="outline"
                      showConfigurationNote={false}
                      className="hero-telegram-cta"
                    />
                  </div>
                </div>
              </div>
            </div>

            <ExecutionStrip />
          </section>

          <section
            id="product-introduction"
            className="mt-20 border-t border-line pt-10 md:mt-28 md:pt-12"
          >
            <div className="max-w-[640px]">
              <SectionLabel>Telegram-native execution</SectionLabel>
              <h2 className="mt-5 text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
                From a clear instruction to verifiable payment proof.
              </h2>
              <p className="mt-4 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                Solvo coordinates USDC payments from Telegram, applies policy
                before funds move, and leaves an auditable KeeperHub-backed
                record behind.
              </p>
              <div className="mt-8">
                <TelegramCta />
              </div>
            </div>
          </section>

          <section
            id="execution-line"
            className="mt-20 scroll-mt-8 grid gap-8 border-t border-line pt-10 md:mt-28 md:pt-12 min-[900px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[900px]:items-center min-[900px]:gap-16"
          >
            <div className="max-w-[640px]">
              <SectionLabel>The Execution Line</SectionLabel>
              <h2 className="mt-5 text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
                Every stage maps to real execution state.
              </h2>
              <p className="mt-4 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                Request, validation, approval, submission and proof are backed
                by persisted execution data rather than decorative progress.
              </p>
            </div>
            <div className="flex min-h-28 items-center border-y border-line py-8 min-[900px]:justify-end">
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
          </section>

          <section
            id="check"
            className="mt-20 scroll-mt-8 grid gap-8 border-t border-line pt-10 md:mt-28 md:pt-12 min-[900px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[900px]:items-center min-[900px]:gap-16"
          >
            <div className="max-w-[640px]">
              <SectionLabel>Agent decision visibility</SectionLabel>
              <h2 className="mt-5 text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
                The agent shows its working.
              </h2>
              <p className="mt-4 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                Validations, policy outcomes and tool actions remain visible.
                Internal chain-of-thought never is.
              </p>
            </div>
            <div className="min-w-0">
              <AgentChecks
                items={[]}
                emptyLabel="Waiting for a payment instruction"
                emptyDescription="A live request will list checks here: destination, token, amount, policy, simulation — each with a written state word."
              />
            </div>
          </section>

          <section id="use-cases" className="mt-20 md:mt-28">
            <div className="grid border-y border-line min-[900px]:grid-cols-2">
              <div className="py-10 min-[900px]:pr-12">
                <SectionLabel>Community</SectionLabel>
                <h2 className="mt-5 text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary">
                  Contributor payouts, rewards and grants.
                </h2>
                <p className="mt-4 max-w-[640px] text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                  Upload the list once. Solvo validates every row, routes
                  approval to the right treasury role and reports the result
                  recipient by recipient.
                </p>
                <div className="mt-6">
                  <Cta href="/community">Community treasury</Cta>
                </div>
              </div>
              <div className="border-t border-line py-10 min-[900px]:border-l min-[900px]:border-t-0 min-[900px]:pl-12">
                <SectionLabel>Individuals</SectionLabel>
                <h2 className="mt-5 text-xl font-medium leading-[1.2] tracking-[-0.01em] text-primary">
                  Direct payments and claim links.
                </h2>
                <p className="mt-4 max-w-[640px] text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                  Send USDC from the conversation — not from a maze of wallet
                  screens. The destination is shown before anything moves.
                </p>
                <div className="mt-6">
                  <Cta href="/individuals">Personal payments</Cta>
                </div>
              </div>
            </div>
          </section>

          <section
            id="prove"
            className="mt-20 scroll-mt-8 grid gap-8 border-t border-line pt-10 md:mt-28 md:pt-12 min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] min-[900px]:items-center min-[900px]:gap-16"
          >
            <div className="min-w-0 max-w-[760px]">
              <ExecutionReceipt
                reference="—"
                fields={[
                  { label: "Requested by", value: "—" },
                  { label: "Recipient", value: "—" },
                  { label: "Amount", value: "—" },
                  { label: "Network", value: "—" },
                  { label: "Execution", value: "—", mono: true },
                  { label: "Transaction hash", value: "—", mono: true },
                  { label: "Audit", value: "—" },
                ]}
                status={{
                  label: "Waiting for a payment instruction",
                  tone: "pending",
                }}
              />
            </div>
            <div className="max-w-[640px] min-[900px]:order-last">
              <SectionLabel>The Execution Receipt</SectionLabel>
              <h2 className="mt-5 text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
                Proof is the success state.
              </h2>
              <p className="mt-4 text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
                No payment is complete until it is proved. The transaction hash
                and audit record outrank any celebration.
              </p>
            </div>
          </section>

          <section
            id="final-action"
            className="mt-20 border-t border-line py-16 text-center md:mt-32 md:py-24"
          >
            <h2 className="mx-auto max-w-[640px] text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
              Request it in chat.
              <br />
              Prove it onchain.
            </h2>
            <div className="mt-10 flex justify-center">
              <TelegramCta />
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </div>
  );
}
