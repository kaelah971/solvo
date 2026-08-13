import Link from "next/link";

import { Wordmark } from "@/components/Wordmark";

const footerLinks = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Community", href: "/community" },
  { label: "Individuals", href: "/individuals" },
  { label: "Security", href: "/security" },
  { label: "Sandbox", href: "/sandbox" },
  { label: "Judge demo", href: "/judge" },
] as const;

export function Footer() {
  return (
    <footer className="site-footer hairline-top mt-16 py-8">
      <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-xs text-[12px] leading-[1.5] tracking-[0.05em] text-muted">
            No payment is complete until it is proved.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-8 gap-y-3">
          {footerLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-11 items-center text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] text-muted transition-colors hover:text-primary"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="hairline-top mt-8 flex flex-col gap-2 pt-6 text-[11px] leading-[1.4] tracking-[0.15em] text-muted md:flex-row md:justify-between">
        <p>Solvo — Conversational Treasury Execution</p>
        <p><span className="footer-signal" aria-hidden="true" /> KeeperHub-backed execution</p>
      </div>
    </footer>
  );
}
