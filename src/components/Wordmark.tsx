type WordmarkProps = {
  className?: string;
};

/** The visible Solvo wordmark: compact, widely tracked, and muted. */
export function Wordmark({ className = "" }: WordmarkProps) {
  return (
    <span
      className={`whitespace-nowrap text-[13px] font-medium uppercase leading-none tracking-[0.48em] text-wordmark ${className}`}
    >
      SOLVO
    </span>
  );
}
