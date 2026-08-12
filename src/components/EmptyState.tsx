type EmptyStateProps = {
  label: string;
  description?: string;
  className?: string;
};

/** Truthful empty state. No icons, no decorations — just a clear statement. */
export function EmptyState({ label, description, className = "" }: EmptyStateProps) {
  return (
    <div className={`border-y border-line bg-white/[0.015] px-6 py-10 text-center ${className}`}>
      <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
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
