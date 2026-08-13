type CtaProps = {
  children: React.ReactNode;
  href?: string;
  disabled?: boolean;
  title?: string;
  target?: string;
  rel?: string;
  className?: string;
  variant?: "outline" | "light" | "dark";
};

/**
 * Solvo outline action. Transparent background, hairline border, no fill on
 * hover. When `disabled`, renders a non-interactive element that never
 * pretends to work.
 */
export function Cta(props: CtaProps) {
  const {
    children,
    href,
    disabled = false,
    title,
    target,
    rel,
    className = "",
    variant = "outline",
  } = props;
  const variantStyles = {
    outline: "cta-outline border-[rgba(255,255,255,0.15)] text-primary",
    light: "cta-light border-[#ff7417] bg-[#ff7417] text-[#160b05]",
    dark: "cta-dark border-[rgba(255,255,255,0.11)] bg-[#151515] text-primary",
  }[variant];
  const disabledVariantStyles = {
    outline: "border-[rgba(255,255,255,0.08)] text-muted",
    light: "border-[#b95516] bg-[#b95516] text-[#160b05] opacity-80",
    dark: "border-[rgba(255,255,255,0.08)] bg-[#151515] text-muted",
  }[variant];
  const styles = `inline-flex min-h-11 items-center justify-center gap-2 border px-6 py-[10px] text-[11px] font-semibold leading-[1.2] tracking-[-0.01em] ${
    disabled
      ? `cursor-not-allowed ${disabledVariantStyles}`
      : variantStyles
  } ${className}`;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        title={title}
        className={`${styles} rounded-full`}
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
        className={`${styles} outline-action rounded-full`}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      title={title}
      className={`${styles} outline-action rounded-full`}
    >
      {children}
    </button>
  );
}
