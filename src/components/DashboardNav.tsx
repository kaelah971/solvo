"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type DashboardSection = { href: string; label: string };

function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** A small client boundary keeps pathname state out of the server-rendered dashboard pages. */
export function DashboardNav({ sections }: { sections: readonly DashboardSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="dashboard-sections"
        onClick={() => setOpen((value) => !value)}
        className="mx-3 mb-3 inline-flex min-h-11 items-center justify-between rounded-lg border border-white/[0.08] px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary md:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
    <nav
      id="dashboard-sections"
      className={`${open ? "flex" : "hidden"} min-w-0 flex-col gap-1 px-3 pb-3 md:flex md:flex-1 md:px-3 md:pb-5`}
      aria-label="Dashboard sections"
    >
      {sections.map((section) => {
        const active = isActiveRoute(pathname, section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`group relative shrink-0 rounded-lg px-3 py-2.5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.16em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a00] md:w-full md:px-4 md:py-3 ${
              active ? "bg-white/[0.06] text-primary" : "text-muted hover:bg-white/[0.035] hover:text-primary"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#ff6a00] transition-opacity md:inset-y-2.5 md:left-0 md:right-auto md:h-auto md:w-0.5 ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
              }`}
            />
            {section.label}
          </Link>
        );
      })}

      <Link
        href="/auth/logout"
        onClick={() => setOpen(false)}
        className="shrink-0 rounded-lg px-3 py-2.5 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.16em] text-muted transition-colors hover:bg-white/[0.035] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a00] md:mt-auto md:w-full md:px-4 md:py-3"
      >
        Sign out
      </Link>
    </nav>
    </>
  );
}
