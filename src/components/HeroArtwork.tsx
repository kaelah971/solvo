/** Compact foreground core; the supplied raster artwork provides the hero field. */
export function HeroArtwork() {
  return (
    <div className="hero-artwork" aria-hidden="true">
      <svg className="hero-artwork-svg" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="solvo-core" cx="0" cy="0" r="1" gradientTransform="translate(120 112) rotate(124) scale(92 88)">
            <stop stopColor="#fff8ed" />
            <stop offset="0.18" stopColor="#ffbf70" />
            <stop offset="0.48" stopColor="#ff7417" />
            <stop offset="0.76" stopColor="#7e2608" />
            <stop offset="1" stopColor="#090706" />
          </radialGradient>
          <filter id="solvo-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        <circle cx="120" cy="120" r="96" fill="#ff6c11" opacity="0.38" filter="url(#solvo-glow)" />
        <circle cx="120" cy="120" r="72" fill="url(#solvo-core)" />
        <circle cx="120" cy="120" r="73" stroke="#ffc27b" strokeOpacity="0.34" />
        <path d="M79 92C101 65 146 61 171 90" stroke="#fff1d9" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        <path d="M72 142C96 174 148 181 177 144" stroke="#ff7b1d" strokeWidth="2" strokeLinecap="round" opacity="0.72" />
      </svg>
    </div>
  );
}
