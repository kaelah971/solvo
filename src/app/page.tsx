import type { Metadata } from "next";
import Image from "next/image";

import { AgentChecks } from "@/components/AgentChecks";
import { Cta } from "@/components/Cta";
import { ExecutionLine } from "@/components/ExecutionLine";
import { ExecutionReceipt } from "@/components/ExecutionReceipt";
import { ExecutionStrip } from "@/components/ExecutionStrip";
import { Footer } from "@/components/Footer";
import { HeroArtwork } from "@/components/HeroArtwork";
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
    <div className="site-substrate home-page min-h-screen">
      <div className="site-inner">
        <main>
          <div className="landing-panel">
            <SiteNav />
           <section className="landing-hero relative flex flex-col overflow-hidden">
             <div className="hero-background" aria-hidden="true">
               <Image
                 src="/images/ChatGPT%20Image%20Aug%2013%2C%202026%2C%2003_11_46%20PM.png"
                 alt=""
                 fill
                 priority
                 sizes="(min-width: 1352px) 1320px, calc(100vw - 32px)"
                 className="hero-background-image"
               />
             </div>
             <div className="hero-copy hero-enter-delayed relative z-10 flex flex-col items-center text-center">
              <div className="execution-badge">
                <span className="execution-badge-dot" aria-hidden="true" />
                KeeperHub-backed / Web3 execution
              </div>
              <h1 className="hero-title">
                Meet! <span className="hero-title-accent">Solvo</span>
              </h1>
              <p className="hero-description">
                Telegram payment coordination with KeeperHub-backed proof.
              </p>
              <div className="hero-actions">
                <TelegramCta
                  label="Open Solvo"
                  variant="light"
                  showConfigurationNote={false}
                  className="hero-telegram-cta"
                />
                <Cta href="#product" variant="dark">Learn more</Cta>
              </div>
            </div>
            <div className="hero-visual hero-enter">
              <span className="hero-state hero-state-request">Requested</span>
              <span className="hero-state hero-state-check">Validated</span>
              <span className="hero-state hero-state-approve">Approved</span>
              <span className="hero-state hero-state-keeper">KeeperHub</span>
              <span className="hero-state hero-state-execute">Executed</span>
              <span className="hero-state hero-state-prove">Proved</span>
              <HeroArtwork />
            </div>
          </section>
          <ExecutionStrip />
          </div>

          <section
            id="product"
            className="home-section mt-20 scroll-mt-8 border-t border-line pt-10 md:mt-28 md:pt-12"
          >
            <span id="product-introduction" className="anchor-alias" aria-hidden="true" />
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
            className="home-section mt-20 scroll-mt-8 grid gap-8 border-t border-line pt-10 md:mt-28 md:pt-12 min-[900px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[900px]:items-center min-[900px]:gap-16"
          >
            <span id="how-it-works" className="anchor-alias" aria-hidden="true" />
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
