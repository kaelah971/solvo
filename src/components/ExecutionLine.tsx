export type ExecutionStage = {
  label: string;
  status: "complete" | "current" | "pending" | "failed";
};

type ExecutionLineProps = {
  stages: ExecutionStage[];
  className?: string;
  /** Spoken summary for assistive technology. */
  announce?: string;
};

const stageStyles: Record<ExecutionStage["status"], string> = {
  complete: "border-[color:var(--color-orange,#ff6a1a)]/40 text-[var(--color-orange,#ff6a1a)]",
  current: "border-[color:var(--color-orange,#ff6a1a)] bg-[var(--color-orange,#ff6a1a)] text-black",
  pending: "text-muted",
  failed: "border-state-error/40 text-state-error",
};

/**
 * REQUEST → CHECK → APPROVE → EXECUTE → PROVE
 *
 * The recurring product primitive. Not a decorative progress bar: each stage
 * corresponds to a real product state and is backed by written labels.
 */
export function ExecutionLine({ stages, className = "", announce }: ExecutionLineProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      aria-label={announce}
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      {stages.map((stage, index) => (
        <span key={stage.label} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-[10px] text-faint">
              →
            </span>
          )}
          <span
            aria-current={stage.status === "current" ? "step" : undefined}
            className={`rounded-full border border-transparent px-3 py-2 text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.16em] ${stageStyles[stage.status]}`}
          >
            {stage.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Build stage arrays from a simple label list plus an active index. */
export function executionLine(
  labels: readonly string[],
  currentIndex: number,
  options: { failedLabel?: string } = {},
): ExecutionStage[] {
  return labels.map((label, index) => {
    if (options.failedLabel && index === currentIndex) {
      return { label: options.failedLabel, status: "failed" };
    }
    if (index < currentIndex) {
      return { label, status: "complete" };
    }
    if (index === currentIndex) {
      return { label, status: "current" };
    }
    return { label, status: "pending" };
  });
}
