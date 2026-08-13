type WordmarkProps = {
  className?: string;
};

/** The visible Solvo wordmark. Orange is the shared brand signal. */
export function Wordmark({ className = "" }: WordmarkProps) {
  return (
    <span
      className={`solvo-wordmark whitespace-nowrap text-[15px] font-semibold leading-none tracking-[-0.035em] ${className}`}
    >
      Solvo<span className="solvo-wordmark-point" aria-hidden="true">.</span>
    </span>
  );
}
