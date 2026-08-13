"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { submitClaimDestination, type ClaimSubmitResult } from "../actions";

type ClaimFormProps = {
  token: string;
  amountUsdc: string;
};

/**
 * Destination wallet form for a valid claim link. Submitting only RECORDS the
 * address — no payout is created and no funds can move from this page.
 */
export function ClaimForm({ token, amountUsdc }: ClaimFormProps) {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<ClaimSubmitResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = address.trim();
    if (trimmed.length === 0) {
      setResult({ ok: false, state: "invalid_address", message: "Enter a wallet address." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const outcome = await submitClaimDestination(token, trimmed);
      setResult(outcome);
      if (outcome.ok) {
        inputRef.current?.blur();
        // Re-render the server page so the panel moves to the approved/claimed state.
        router.refresh();
      }
    });
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mt-8 max-w-xl" noValidate>
        <label
          htmlFor="claim-destination"
          className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted"
        >
          Destination wallet · {amountUsdc} USDC
        </label>
        <input
          ref={inputRef}
          id="claim-destination"
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={isPending}
          aria-disabled={isPending}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="mt-3 w-full rounded-[14px] border border-border bg-black/25 px-4 py-3 font-data text-[12px] leading-[1.35] tracking-[0.04em] text-primary placeholder:text-faint focus:border-[var(--color-orange,#ff6a1a)]"
        />
        <button
          type="submit"
          disabled={isPending}
          className="mt-4 rounded-full border border-[var(--color-orange,#ff6a1a)] bg-[var(--color-orange,#ff6a1a)] px-6 py-3 text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Recording…" : "Submit destination"}
        </button>
      </form>

      <p className="mt-3 text-[11px] leading-[1.4] tracking-[0.08em] text-muted">
        Submitting only records the wallet. The sender must approve it before
        KeeperHub execution — nothing moves from this page.
      </p>

      {result && (
        <p
          role="status"
          aria-live="polite"
          className={
            "mt-4 rounded-[14px] border px-4 py-3 text-[12px] leading-[1.5] tracking-[0.04em] " +
            (result.ok
              ? "border-border text-secondary"
              : result.state === "invalid_address"
                ? "border-border text-secondary"
                : "border-border text-secondary")
          }
        >
          {result.ok ? "✓ " + result.message : result.message}
        </p>
      )}
    </div>
  );
}
