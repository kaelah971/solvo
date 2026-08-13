type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

/** Compact orange eyebrow used to orient each public content section. */
export function SectionLabel({ children, className = "" }: SectionLabelProps) {
  return (
    <p
      className={`flex items-center gap-2 text-pretty text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-[var(--color-orange,#ff6a1a)] before:block before:h-px before:w-5 before:bg-[var(--color-orange,#ff6a1a)] ${className}`}
    >
      {children}
    </p>
  );
}
