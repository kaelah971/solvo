"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { TelegramCta } from "@/components/TelegramCta";

const primaryLinks = [
  { label: "Product", href: "/community" },
  { label: "How it works", href: "/how-it-works" },
] as const;

const menuLinks = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Community", href: "/community" },
  { label: "Individuals", href: "/individuals" },
  { label: "Security", href: "/security" },
  { label: "Sandbox", href: "/sandbox" },
  { label: "Judge demo", href: "/judge" },
] as const;

const linkClass = (active: boolean) =>
  `inline-flex min-h-11 items-center text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] transition-colors duration-200 ${
    active ? "text-primary" : "text-muted hover:text-primary"
  }`;

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <nav
      aria-label="Primary"
      className="relative flex items-center justify-between py-5"
    >
      <Link
        href="/"
        aria-label="Solvo home"
        className="inline-flex min-h-11 min-w-11 items-center text-[16px] font-semibold uppercase tracking-[0.28em] text-primary"
      >
        S
      </Link>

      <div className="hidden items-center gap-8 md:flex">
        {primaryLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={linkClass(pathname === link.href)}
          >
            {link.label}
          </Link>
        ))}
        <TelegramCta
          label="Telegram"
          variant="text"
          showConfigurationNote={false}
          className="ml-2"
        />
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className={`inline-flex min-h-11 min-w-11 items-center justify-end text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] transition-colors md:hidden ${
          open ? "text-primary" : "text-muted hover:text-primary"
        }`}
      >
        {open ? "Close" : "Menu"}
      </button>

      {open && (
        <div
          id="site-menu"
          className="absolute inset-x-0 top-[72px] z-40 bg-void px-6 pb-8 md:hidden"
        >
          <ul className="hairline-bottom flex flex-col divide-y divide-line border-line">
            {menuLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center py-4 text-[12px] font-medium uppercase leading-[1.2] tracking-[0.2em] text-secondary hover:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-center">
            <TelegramCta />
          </div>
        </div>
      )}
    </nav>
  );
}
