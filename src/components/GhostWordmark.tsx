type GhostWordmarkProps = {
  className?: string;
  "aria-hidden"?: boolean;
};

/** Oversized SOLVO texture with a decorative living-light layer. */
export function GhostWordmark({ className = "" }: GhostWordmarkProps) {
  return (
    <div
      aria-hidden="true"
      className={`ghost-wordmark font-display text-[clamp(3.375rem,6.75vw,7.02rem)] font-[650] leading-[0.9] tracking-[0.28em] ${className}`}
    >
      <span className="ghost-wordmark-base">SOLVO</span>
      <span aria-hidden="true" className="ghost-wordmark-sweep absolute inset-0">
        SOLVO
      </span>
    </div>
  );
}
