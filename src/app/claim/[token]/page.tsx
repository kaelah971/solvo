import type { Metadata } from "next";

import { ClaimPanel } from "@/components/ClaimPanel";
import { PageShell } from "@/components/PageShell";
import { SectionLabel } from "@/components/SectionLabel";

export const metadata: Metadata = {
  title: "Claim",
  description:
    "Claim a Solvo payment link. The destination address is supplied by the recipient and approved by the sender before anything moves through KeeperHub.",
};

/**
 * Claim page. No backend is connected yet, so every token truthfully renders
 * the unavailable state: nothing is ever fabricated from the route parameter.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <PageShell className="pt-10 md:pt-16">
      <div className="mx-auto w-full max-w-3xl">
        <ClaimPanel state="unavailable" token={token} />
      </div>

      <section className="mx-auto mt-24 w-full max-w-3xl border-t border-line pt-10">
        <SectionLabel>When a claim is connected</SectionLabel>
        <h2 className="mt-5 font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          The destination appears before anything moves.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          A real claim experience will prioritize the amount, the token, the
          destination address input and explicit sender approval before money
          moves. The link remains single-use and expires after a fixed period.
        </p>

        <div className="mt-8 max-w-xl">
          <label
            htmlFor="claim-destination"
            className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted"
          >
            Destination
          </label>
          <input
            id="claim-destination"
            type="text"
            disabled
            aria-disabled="true"
            placeholder="Destination address will be required once claims are connected"
            className="mt-3 w-full border border-border bg-void px-4 py-3 font-data text-[12px] leading-[1.35] tracking-[0.04em] text-faint placeholder:text-faint"
          />
          <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
            Input is disabled until claims are connected to KeeperHub
            execution.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
