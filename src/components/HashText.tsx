"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type HashTextProps = {
  value: string;
  className?: string;
};

function truncate(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

/**
 * Addresses and hashes: truncated, selectable and copyable.
 * Never breaks a layout and never hides the full value without a copy path.
 */
export function HashText({ value, className = "" }: HashTextProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="data-break font-data text-[11px] tracking-[0.04em] text-secondary">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy full value"
        className="shrink-0 cursor-pointer border border-[rgba(255,255,255,0.12)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted transition-colors hover:border-[rgba(255,255,255,0.35)] hover:text-primary"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export function truncatedHash(value: string): string {
  return truncate(value);
}
