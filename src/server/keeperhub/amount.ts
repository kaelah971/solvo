export const PROOF_MAX_AMOUNT_USDC = "0.10";
export const USDC_DECIMALS = 6;

export type AmountValidationResult =
  | { ok: true; amount: string }
  | { ok: false; reason: string };

export function canonicalizeAmount(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "0";
  if (trimmed.startsWith("+") || trimmed.startsWith("-")) return "invalid";
  if (trimmed.includes("e") || trimmed.includes("E")) return "invalid";

  let whole = trimmed;
  let fraction = "";
  const dot = trimmed.indexOf(".");
  if (dot >= 0) {
    whole = trimmed.slice(0, dot);
    fraction = trimmed.slice(dot + 1);
    if (whole.length === 0) whole = "0";
    if (!/^\d*$/.test(fraction)) return "invalid";
  }
  if (!/^\d+$/.test(whole)) return "invalid";

  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length === 0) return whole;
  return `${whole}.${fraction}`;
}

export function parseUsdcAmount(raw: string): AmountValidationResult {
  const canonical = canonicalizeAmount(raw);
  if (canonical === "invalid") {
    return {
      ok: false,
      reason: "Amount must be a positive decimal number without exponents or signs.",
    };
  }

  const [whole, fraction = ""] = canonical.split(".");
  if (whole === "0" && fraction.length === 0) {
    return { ok: false, reason: "Amount must be greater than zero." };
  }
  if (fraction.length > USDC_DECIMALS) {
    return { ok: false, reason: `USDC supports at most ${USDC_DECIMALS} decimal places.` };
  }

  const numeric = Number(canonical);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, reason: "Amount must be a positive number." };
  }
  if (numeric > Number(PROOF_MAX_AMOUNT_USDC)) {
    return {
      ok: false,
      reason: `Amount exceeds the proof hard cap of ${PROOF_MAX_AMOUNT_USDC} USDC per transaction.`,
    };
  }
  return { ok: true, amount: canonical };
}

/**
 * Same format rules as parseUsdcAmount (no exponents/signs, at most 6 decimal
 * places, positive) WITHOUT the 0.10 USDC per-transaction cap. Used for
 * policy LIMITS (e.g. the judge daily cap of 1.00 USDC), which are not
 * payments and must not be constrained by the payment cap.
 */
export function parseUsdcLimitAmount(raw: string): AmountValidationResult {
  const canonical = canonicalizeAmount(raw);
  if (canonical === "invalid") {
    return {
      ok: false,
      reason: "Amount must be a positive decimal number without exponents or signs.",
    };
  }
  const [whole, fraction = ""] = canonical.split(".");
  if (whole === "0" && fraction.length === 0) {
    return { ok: false, reason: "Amount must be greater than zero." };
  }
  if (fraction.length > USDC_DECIMALS) {
    return { ok: false, reason: `USDC supports at most ${USDC_DECIMALS} decimal places.` };
  }
  const numeric = Number(canonical);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, reason: "Amount must be a positive number." };
  }
  return { ok: true, amount: canonical };
}
