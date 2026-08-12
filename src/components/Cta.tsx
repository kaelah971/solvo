type CtaProps = {
  children: React.ReactNode;
  href?: string;
  disabled?: boolean;
  title?: string;
  target?: string;
  rel?: string;
  className?: string;
};

/**
 * Solvo outline action. Transparent background, hairline border, no fill on
 * hover. When `disabled`, renders a non-interactive element that never
 * pretends to work.
 */
export function Cta({
  children,
  href,
  disabled = false,
  title,
  target,
  rel,
  className = "",
}: CtaProps) {
  const styles = `inline-flex min-h-11 items-center justify-center gap-2 border px-6 py-[10px] text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] transition-colors duration-200 ${
    disabled
      ? "cursor-not-allowed border-[rgba(255,255,255,0.08)] text-muted"
      : "border-[rgba(255,255,255,0.15)] text-primary hover:border-[rgba(255,255,255,0.35)]"
  } ${className}`;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        title={title}
        className={`${styles} rounded-[2px]`}
      >
        {children}
      </span>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        title={title}
        target={target}
        rel={rel}
        className={`${styles} rounded-[2px]`}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" title={title} className={`${styles} rounded-[2px]`}>
      {children}
    </button>
  );
}
