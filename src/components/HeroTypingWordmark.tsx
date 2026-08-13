type HeroTypingWordmarkProps = {
  className?: string;
};

/** Decorative hero-only wordmark with a fixed footprint and repeating type cycle. */
export function HeroTypingWordmark({ className = "" }: HeroTypingWordmarkProps) {
  return (
    <div aria-hidden="true" className={`hero-typing-shell relative inline-grid ${className}`}>
      <span aria-hidden="true" className="hero-lamp-rays" />
      <span className="hero-typing-measure invisible col-start-1 row-start-1">SOLVO</span>
      <span aria-hidden="true" className="hero-typing-ghost col-start-1 row-start-1">SOLVO</span>
      <span className="hero-typing-wordmark col-start-1 row-start-1">SOLVO</span>
      <span aria-hidden="true" className="hero-lamp-lit-wordmark col-start-1 row-start-1">SOLVO</span>
      <span aria-hidden="true" className="hero-typing-cursor">&nbsp;</span>
    </div>
  );
}
