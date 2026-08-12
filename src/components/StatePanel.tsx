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
      className={`border-y border-line bg-white/[0.015] px-6 py-10 sm:px-10 sm:py-12 ${className}`}
    >
      <StatusLabel label={badge} tone={tone} />
      <h1 className="mt-4 text-balance text-2xl font-medium leading-[1.1] tracking-[-0.01em] text-primary sm:text-3xl">
        {headline}
      </h1>
      <p className="mt-4 max-w-xl text-pretty text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
        {body}
      </p>
      {children && <div className="mt-8">{children}</div>}
    </section>
  );
}
