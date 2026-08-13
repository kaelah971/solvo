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
      className={`content-panel overflow-hidden rounded-[28px] border border-border bg-surface px-5 py-5 sm:px-8 sm:py-7 ${className}`}
    >
      <p className="border-b border-line pb-5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-[var(--color-orange,#ff6a1a)]">
        {title}
      </p>

      <dl className="mt-4">
        <ProofRow label="Recipients" value={recipients ?? "—"} />
        <ProofRow label="Total" value={total ?? "—"} />
        <ProofRow label="Valid" value={valid ?? "—"} />
        <ProofRow label="Duplicates" value={duplicates ?? "—"} />
        <ProofRow label="Approval" value={approval ?? "—"} />
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
          Status
        </p>
        <StatusLabel label={statusLabel ?? "No payout loaded"} tone={statusTone} />
      </div>
    </section>
  );
}
