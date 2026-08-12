import Image from "next/image";

type LampProps = {
  className?: string;
};

/** The single decorative illustration in the landing hero. */
export function Lamp({ className = "" }: LampProps) {
  return (
    <Image
      src="/images/solvo-pendant-lamp-v3.png"
      alt=""
      aria-hidden="true"
      width={1024}
      height={1536}
      sizes="(max-height: 500px) and (min-width: 640px) 168px, (max-width: 640px) 250px, max(270px, min(24vw, 360px))"
      preload
      draggable={false}
      className={className}
    />
  );
}
