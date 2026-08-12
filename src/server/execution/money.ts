import { canonicalizeAmount, USDC_DECIMALS } from "../keeperhub/amount.ts";

export type BaseUnitsResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: string };

const UNIT = 10n ** BigInt(USDC_DECIMALS);

export function usdcToBaseUnits(amount: string): BaseUnitsResult {
  const canonical = canonicalizeAmount(amount);
  if (canonical === "invalid") {
    return { ok: false, reason: "Amount must be a positive decimal number without exponents or signs." };
  }

  const [whole, fraction = ""] = canonical.split(".");
  if (whole === "0" && fraction.length === 0) {
    return { ok: false, reason: "Amount must be greater than zero." };
  }
  if (fraction.length > USDC_DECIMALS) {
    return { ok: false, reason: `USDC supports at most ${USDC_DECIMALS} decimal places.` };
  }

  try {
    const wholeValue = BigInt(whole);
    const fractionValue = BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
    return { ok: true, value: wholeValue * UNIT + fractionValue };
  } catch {
    return { ok: false, reason: "Amount is not a valid integer." };
  }
}

export function baseUnitsToUsdc(value: bigint): string {
  if (value < 0n) return "invalid";
  const whole = value / UNIT;
  let fraction = (value % UNIT).toString().padStart(USDC_DECIMALS, "0");
  fraction = fraction.replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}
