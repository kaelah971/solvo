import { ProofRow } from "@/components/ProofRow";
import type { StatusTone } from "@/components/StatusLabel";
import { StatusLabel } from "@/components/StatusLabel";

export type ReceiptField = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
};

export type ReceiptStatus = {
  label: string;
  tone: StatusTone;
};

type ExecutionReceiptProps = {
  /** Receipt reference, e.g. SOLVO PAYMENT / 00421. Empty when unknown. */
  reference?: string | null;
  fields: ReceiptField[];
  status?: ReceiptStatus | null;
  className?: string;
};

/**
 * The principal proof component. Amount and status outrank low-level IDs;
 * simulation and real execution are never worded the same. Absent data
 * renders as "—": nothing is invented.
 */
export function ExecutionReceipt({
  reference = null,
  fields,
  status = null,
  className = "",
}: ExecutionReceiptProps) {
  return (
    <section
      aria-label="Solvo Execution Receipt"
      className={`border-y border-line bg-white/[0.015] px-6 py-6 sm:px-8 ${className}`}
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-primary">
          Solvo Payment
        </p>
        <p className="font-data text-[11px] tracking-[0.08em] text-faint tabular-nums">
          {reference ?? "—"}
        </p>
      </header>

      <dl className="mt-4">
        {fields.map((field) => {
          const emphasized = ["Amount", "Recipient", "Transaction hash"].includes(field.label);

          return (
            <ProofRow
              key={field.label}
              label={field.label}
              value={
                <span className={emphasized ? "text-primary" : "text-secondary"}>
                  {field.value}
                </span>
              }
              mono={field.mono}
            />
          );
        })}
      </dl>

      {status && (
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
          <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
            Status
          </p>
          <StatusLabel label={status.label} tone={status.tone} className="!text-primary" />
        </div>
      )}
    </section>
  );
}
