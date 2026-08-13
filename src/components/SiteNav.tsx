"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { TelegramCta } from "@/components/TelegramCta";
import { Wordmark } from "@/components/Wordmark";

const primaryLinks = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
] as const;

const menuLinks = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Community", href: "/community" },
  { label: "Individuals", href: "/individuals" },
  { label: "Security", href: "/security" },
  { label: "Sandbox", href: "/sandbox" },
  { label: "Judge demo", href: "/judge" },
] as const;

const linkClass = (active: boolean) =>
  `nav-interaction inline-flex min-h-11 items-center text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] ${
    active ? "text-primary" : "text-secondary"
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
      className="site-nav relative grid min-h-[76px] grid-cols-[1fr_auto] items-center py-4 md:grid-cols-[1fr_auto_1fr]"
    >
      <Link
        href="/"
        aria-label="Solvo home"
        className="inline-flex min-h-11 items-center justify-self-start"
      >
        <Wordmark />
      </Link>

      <div className="nav-capsule hidden items-center gap-1 justify-self-center md:flex">
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
        />
      </div>

      <div className="hidden justify-self-end md:block">
        <TelegramCta label="Open Solvo" variant="light" showConfigurationNote={false} className="nav-open-solvo" />
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className={`nav-interaction inline-flex min-h-11 min-w-11 items-center justify-end text-[11px] font-medium uppercase leading-[1.2] tracking-[0.2em] md:hidden ${
          open ? "text-primary" : "text-muted"
        }`}
      >
        {open ? "Close" : "Menu"}
      </button>

      {open && (
        <div
          id="site-menu"
          className="mobile-site-menu absolute inset-x-0 top-[72px] z-40 px-6 pb-8 md:hidden"
        >
          <ul className="hairline-bottom flex flex-col divide-y divide-line border-line">
            {menuLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="nav-interaction flex min-h-11 items-center py-4 text-[12px] font-medium uppercase leading-[1.2] tracking-[0.2em] text-secondary"
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
