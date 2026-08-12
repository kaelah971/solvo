export type StatusTone = "complete" | "pending" | "error";

const toneStyles: Record<StatusTone, string> = {
  complete: "text-state-complete",
  pending: "text-state-pending",
  error: "text-state-error",
};

type StatusLabelProps = {
  /** The written state word. Never rely on colour alone. */
  label: string;
  tone?: StatusTone;
  className?: string;
};

export function StatusLabel({ label, tone = "pending", className = "" }: StatusLabelProps) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] ${toneStyles[tone]} ${className}`}
    >
      {label}
    </span>
  );
}
