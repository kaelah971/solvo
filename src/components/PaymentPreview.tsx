import { Cta } from "@/components/Cta";
import { ProofRow } from "@/components/ProofRow";

type PaymentPreviewProps = {
  /** Claimed destination address. */
  to?: string | null;
  /** Payment amount. */
  amount?: string | null;
  /** Network of the payment. */
  network?: string | null;
  /** Telegram requester of the payment. */
  requested?: string | null;
  /** Written approval state. */
  approval?: string | null;
  className?: string;
};

/**
 * Payment request preview: the destination and amount always appear before
 * approval. The actions stay disabled until a real request is connected —
 * they never pretend to work.
 */
export function PaymentPreview({
  to = null,
  amount = null,
  network = null,
  requested = null,
  approval = null,
  className = "",
}: PaymentPreviewProps) {
  return (
    <section
      aria-label="Payment request preview"
      className={`border-y border-line bg-white/[0.015] px-6 py-6 sm:px-8 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-primary">
        Payment Request
      </p>

      <dl className="mt-4">
        <ProofRow label="To" value={to ?? "—"} />
        <ProofRow label="Amount" value={amount ?? "—"} />
        <ProofRow label="Network" value={network ?? "—"} />
        <ProofRow label="Requested" value={requested ?? "—"} />
        <ProofRow label="Approval" value={approval ?? "—"} />
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Cta disabled>Approve</Cta>
        <Cta disabled>Cancel</Cta>
      </div>

      <p className="mt-4 text-pretty text-[11px] leading-[1.5] tracking-[0.08em] text-muted">
        This preview is not connected yet. The destination and amount always
        appear before approval.
      </p>
    </section>
  );
}
