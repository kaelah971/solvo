import type { StatusTone } from "@/components/StatusLabel";
import { StatusLabel } from "@/components/StatusLabel";

type StatePanelProps = {
  /** Written state word, e.g. CLAIM UNAVAILABLE. */
  badge: string;
  tone?: StatusTone;
  headline: string;
  body: string;
  children?: React.ReactNode;
  className?: string;
};

/** A truthful state panel: written status, headline, explanation, optional controls. */
export function StatePanel({
  badge,
  tone = "pending",
  headline,
  body,
  children,
  className = "",
}: StatePanelProps) {
  return (
    <section
      className={`content-panel overflow-hidden rounded-[28px] border border-border bg-surface px-6 py-8 sm:px-10 sm:py-11 ${className}`}
    >
      <StatusLabel label={badge} tone={tone} />
      <h1 className="mt-5 max-w-2xl text-balance font-display text-2xl font-medium leading-[1.08] tracking-[-0.02em] text-primary sm:text-4xl">
        {headline}
      </h1>
      <p className="mt-4 max-w-xl text-pretty text-[13px] leading-[1.65] tracking-[0.03em] text-secondary">
        {body}
      </p>
      {children && <div className="mt-8">{children}</div>}
    </section>
  );
}
