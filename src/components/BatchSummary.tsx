import { ProofRow } from "@/components/ProofRow";
import type { StatusTone } from "@/components/StatusLabel";
import { StatusLabel } from "@/components/StatusLabel";

type BatchSummaryProps = {
  /** Batch title, e.g. "Payout / Community rewards". Empty when no payout is loaded. */
  title?: string | null;
  /** Number of recipients in the batch. */
  recipients?: string | null;
  /** Total payout value. */
  total?: string | null;
  /** Number of rows that passed validation. */
  valid?: string | null;
  /** Number of duplicate rows detected. */
  duplicates?: string | null;
  /** Treasury role required for approval. */
  approval?: string | null;
  /** Written state word for the batch. */
  statusLabel?: string | null;
  statusTone?: StatusTone;
  className?: string;
};

/**
 * Batch payout summary shown before the recipient-level table. A treasurer
 * must understand the batch risk before approving. Absent data renders as
 * "—": nothing is invented.
 */
export function BatchSummary({
  title = "Payout / —",
  recipients = null,
  total = null,
  valid = null,
  duplicates = null,
  approval = null,
  statusLabel = "No payout loaded",
  statusTone = "pending",
  className = "",
}: BatchSummaryProps) {
  return (
    <section
      aria-label="Payout batch summary"
      className={`border-y border-line bg-white/[0.015] px-6 py-6 sm:px-8 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-primary">
        {title}
      </p>

      <dl className="mt-4">
        <ProofRow label="Recipients" value={recipients ?? "—"} />
        <ProofRow label="Total" value={total ?? "—"} />
        <ProofRow label="Valid" value={valid ?? "—"} />
        <ProofRow label="Duplicates" value={duplicates ?? "—"} />
        <ProofRow label="Approval" value={approval ?? "—"} />
      </dl>

      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
          Status
        </p>
        <StatusLabel label={statusLabel ?? "No payout loaded"} tone={statusTone} />
      </div>
    </section>
  );
}
