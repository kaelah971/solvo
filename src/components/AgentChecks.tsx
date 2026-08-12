export type CheckStatus = "waiting" | "running" | "passed" | "failed";

export type AgentCheckItem = {
  label: string;
  status?: CheckStatus;
  note?: string;
};

type AgentChecksProps = {
  items: AgentCheckItem[];
  /** Label shown when no checks exist yet. */
  emptyLabel?: string;
  emptyDescription?: string;
  className?: string;
};

const statusWord: Record<CheckStatus, string> = {
  waiting: "Waiting",
  running: "Checking",
  passed: "Passed",
  failed: "Blocked",
};

const statusStyles: Record<CheckStatus, string> = {
  waiting: "text-muted",
  running: "text-state-pending",
  passed: "text-state-complete",
  failed: "text-state-error",
};

/**
 * The agent's visible working: validations, policy outcomes and tool actions —
 * never hidden chain-of-thought. Every row carries a written state word so no
 * meaning relies on colour alone.
 */
export function AgentChecks({
  items,
  emptyLabel = "Waiting for a payment instruction",
  emptyDescription,
  className = "",
}: AgentChecksProps) {
  if (items.length === 0) {
    return (
      <div className={`border-y border-line bg-white/[0.015] px-6 py-8 ${className}`}>
        <p className="text-center text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
          {emptyLabel}
        </p>
        {emptyDescription && (
          <p className="mx-auto mt-2 max-w-md text-pretty text-center text-[13px] leading-[1.5] tracking-[0.05em] text-muted">
            {emptyDescription}
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className={`divide-y divide-line border-y border-line bg-white/[0.015] ${className}`}>
      {items.map((item) => {
        const status: CheckStatus = item.status ?? "waiting";
        return (
          <li
            key={item.label}
            className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span
              className={`shrink-0 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] sm:w-[88px] ${statusStyles[status]}`}
            >
              {statusWord[status]}
            </span>
            <span className="text-[12px] leading-[1.35] tracking-[0.08em] text-secondary">
              {item.label}
              {item.note && (
                <span className="ml-2 text-[11px] tracking-[0.05em] text-muted">
                  {item.note}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
