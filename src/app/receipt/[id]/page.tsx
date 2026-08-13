import type { Metadata } from "next";

import type { ReceiptField } from "@/components/ExecutionReceipt";
import { ExecutionReceipt } from "@/components/ExecutionReceipt";
import { PageShell } from "@/components/PageShell";
import { ProofRow } from "@/components/ProofRow";
import { SectionLabel } from "@/components/SectionLabel";
import { StatePanel } from "@/components/StatePanel";

export const metadata: Metadata = {
  title: "Receipt",
  description:
    "The Solvo Execution Receipt: request, approval, KeeperHub execution and transaction proof for every completed payment.",
};

const receiptFields: ReceiptField[] = [
  { label: "Request ID", value: "—", mono: true },
  { label: "Requester", value: "—" },
  { label: "Recipient", value: "—" },
  { label: "Amount", value: "—" },
  { label: "Network", value: "—" },
  { label: "Approval path", value: "—" },
  { label: "KeeperHub execution ID", value: "—", mono: true },
  { label: "Transaction hash", value: "—", mono: true },
  { label: "Audit record", value: "—" },
  { label: "Timestamp", value: "—" },
  { label: "Final status", value: "—" },
];

/**
 * Receipt page. No execution records exist yet, so any reference truthfully
 * renders "Receipt not found." The receipt format below documents the real
 * fields with "—" values — nothing is invented for the route parameter.
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageShell className="pt-10 md:pt-16">
      <div className="mx-auto w-full max-w-3xl">
        <StatePanel
          badge="RECEIPT NOT FOUND"
          tone="error"
          headline="Receipt not found."
          body="No execution record exists for this reference. An execution receipt is only created after a real payment completes through KeeperHub."
        >
          <div className="hairline-top pt-4">
            <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
              Reference
            </p>
            <p className="data-break mt-2 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">
              {id}
            </p>
          </div>
        </StatePanel>
      </div>

      <section className="content-panel mx-auto mt-8 w-full max-w-3xl rounded-[28px] border border-border bg-surface px-6 py-10 sm:px-10">
        <SectionLabel>The Solvo Execution Receipt</SectionLabel>
        <h2 className="mt-5 font-display text-2xl font-medium leading-[1.15] tracking-[-0.01em] text-primary md:text-3xl">
          One record for every completed payment.
        </h2>
        <p className="mt-4 max-w-xl text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
          A real receipt records the request, the approval path and the
          KeeperHub execution evidence. Every field below is part of the
          format — values are shown here only after a real payment completes.
        </p>

        <dl className="mt-8">
          {receiptFields.map((field) => (
            <ProofRow
              key={field.label}
              label={field.label}
              value={field.value}
              mono={field.mono}
            />
          ))}
        </dl>

        <div className="mt-12">
          <ExecutionReceipt
            reference="—"
            fields={receiptFields}
            status={{ label: "RECEIPT NOT FOUND", tone: "error" }}
          />
        </div>
      </section>
    </PageShell>
  );
}
