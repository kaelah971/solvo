type GhostWordmarkProps = {
  className?: string;
  "aria-hidden"?: boolean;
};

/** Small static SOLVO sub-word beneath the animated hero word. */
export function GhostWordmark({ className = "" }: GhostWordmarkProps) {
  return (
    <div
      aria-hidden="true"
      className={`ghost-wordmark font-display text-[13px] font-normal uppercase leading-none tracking-[0.48em] ${className}`}
    >
      <span className="ghost-wordmark-base">SOLVO</span>
    </div>
  );
}
