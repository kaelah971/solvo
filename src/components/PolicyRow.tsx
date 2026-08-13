import { SectionLabel } from "@/components/SectionLabel";

type PolicyRowProps = {
  index: string;
  title: string;
  children: React.ReactNode;
};

/** Numbered security / policy row used by the trust-model surfaces. */
export function PolicyRow({ index, title, children }: PolicyRowProps) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-line px-1 py-6 first:border-t-0 sm:grid-cols-[48px_220px_1fr] sm:gap-6">
      <p className="font-data text-[11px] tracking-[0.08em] text-[var(--color-orange,#ff6a1a)]">{index}</p>
      <h3 className="text-balance text-[13px] font-semibold leading-[1.4] tracking-[0.08em] text-primary">
        {title}
      </h3>
      <div className="text-pretty text-[13px] leading-[1.6] tracking-[0.05em] text-secondary">
        {children}
      </div>
    </div>
  );
}

export function PolicyRowHeader({ children }: { children: React.ReactNode }) {
  return <SectionLabel className="pb-5">{children}</SectionLabel>;
}
