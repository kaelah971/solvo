type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

/** 11px uppercase section label with wide tracking. */
export function SectionLabel({ children, className = "" }: SectionLabelProps) {
  return (
    <p
      className={`text-pretty text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted ${className}`}
    >
      {children}
    </p>
  );
}
