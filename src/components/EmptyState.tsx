type EmptyStateProps = {
  label: string;
  description?: string;
  className?: string;
};

/** Truthful empty state with restrained product framing. */
export function EmptyState({ label, description, className = "" }: EmptyStateProps) {
  return (
    <div className={`content-panel rounded-[24px] border border-border bg-surface px-6 py-10 text-center ${className}`}>
      <span aria-hidden="true" className="mx-auto mb-5 block h-px w-10 bg-[var(--color-orange,#ff6a1a)]" />
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-primary">
        {label}
      </p>
      {description && (
        <p className="mx-auto mt-3 max-w-md text-pretty text-[13px] leading-[1.5] tracking-[0.05em] text-muted">
          {description}
        </p>
      )}
    </div>
  );
}
