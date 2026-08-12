import { keccak_256 } from "@noble/hashes/sha3.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const HEX_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type AddressValidationResult =
  | { ok: true; address: string }
  | { ok: false; reason: string };

function toChecksumAddress(lowercase: string): string {
  const hash = Buffer.from(keccak_256(Buffer.from(lowercase.slice(2).toLowerCase(), "utf8"))).toString("hex");
  let result = "0x";
  for (let i = 0; i < 40; i += 1) {
    const char = lowercase.slice(2)[i];
    const nibble = parseInt(hash[i], 16);
    result += nibble >= 8 ? char.toUpperCase() : char;
  }
  return result;
}

export function isValidEvmAddress(input: string): AddressValidationResult {
  const trimmed = input.trim();
  if (!HEX_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: "Address must be 40 hex characters prefixed with 0x.",
    };
  }
  const lowercase = trimmed.toLowerCase();
  if (lowercase === ZERO_ADDRESS) {
    return { ok: false, reason: "The zero address is not an acceptable recipient." };
  }
  const checksummed = toChecksumAddress(lowercase);
  if (trimmed !== lowercase && trimmed !== checksummed) {
    return {
      ok: false,
      reason: "Mixed-case address failed EIP-55 checksum validation. Use the exact checksummed form or all-lowercase.",
    };
  }
  return { ok: true, address: lowercase };
}

export function normalizeAddress(input: string): string {
  return input.trim().toLowerCase();
}
