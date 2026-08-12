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
  complete: "text-state-complete",
  current: "text-primary underline decoration-[rgba(237,237,237,0.4)] underline-offset-4",
  pending: "text-muted",
  failed: "text-state-error",
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
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}
    >
      {stages.map((stage, index) => (
        <span key={stage.label} className="flex items-center gap-x-3">
          {index > 0 && (
            <span aria-hidden="true" className="text-[11px] text-faint">
              →
            </span>
          )}
          <span
            aria-current={stage.status === "current" ? "step" : undefined}
            className={`text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] ${stageStyles[stage.status]}`}
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
