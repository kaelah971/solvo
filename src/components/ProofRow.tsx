type ProofRowProps = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
};

/** Label / value row for receipts and proof surfaces. */
export function ProofRow({ label, value, mono = false, className = "" }: ProofRowProps) {
  return (
    <div
      className={`grid grid-cols-1 gap-1 border-t border-line py-3 first:border-t-0 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-4 ${className}`}
    >
      <dt className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
        {label}
      </dt>
      <dd
        className={`data-break min-w-0 text-right text-[12px] leading-[1.35] tracking-[0.08em] text-secondary tabular-nums sm:text-left ${
          mono ? "font-data text-[11px] tracking-[0.04em]" : "font-sans"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
