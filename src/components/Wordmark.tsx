import Image from "next/image";

type WordmarkProps = {
  className?: string;
};

/** Shared brand mark. Its parent link provides the accessible destination name. */
export function Wordmark({ className = "" }: WordmarkProps) {
  return (
    <span
      className={`solvo-wordmark relative block shrink-0 overflow-hidden rounded-[11px] ${className}`}
    >
      <Image
        src="/images/photo_2026-08-13_17-01-38.jpg"
        alt="Solvo"
        fill
        sizes="(max-width: 640px) 38px, 42px"
        className="solvo-wordmark-image"
      />
    </span>
  );
}
