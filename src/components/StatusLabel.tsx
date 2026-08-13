export type StatusTone = "complete" | "pending" | "error";

const toneStyles: Record<StatusTone, string> = {
  complete: "border-[color:var(--color-orange,#ff6a1a)]/45 text-[var(--color-orange,#ff6a1a)]",
  pending: "border-line text-secondary",
  error: "border-state-error/40 text-state-error",
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
      className={`inline-flex w-fit items-center rounded-full border bg-black/20 px-3 py-1.5 text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.15em] ${toneStyles[tone]} ${className}`}
    >
      {label}
    </span>
  );
}
