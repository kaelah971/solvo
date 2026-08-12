import type {
  AgentAction,
  CandidateAddress,
  CandidateAlias,
  CandidateAmount,
  CandidateChain,
  CandidateClaimAmount,
  CandidatePayoutId,
  CandidateToken,
  MissingFieldKey,
  PaymentCandidates,
} from "./types.ts";
import { redactAgentRawText } from "./redact.ts";

/**
 * M8 — Deterministic candidate extraction.
 *
 * Extracts typed, provenance-rich candidates from raw message text so that a
 * later interpreter may only SELECT from them (candidate provenance). Pure
 * and deterministic: no timestamps, no randomness, no I/O, no network, no
 * database. Hostile instructions are surfaced as unsafe flags and never
 * become candidates or actions.
 *
 * The amount grammar mirrors keeperhub/amount.ts (positive decimal, no
 * signs/exponents, ≤ 6 decimals) WITHOUT importing keeperhub, keeping the
 * agent layer import-clean. Full EVM address validation (checksum/zero
 * rules) remains the planner's authority; extraction only marks the zero
 * address invalid and preserves the raw text.
 */

export type ExtractionResult = {
  candidates: PaymentCandidates;
  /** Bounded action hints derived from verbs; empty means "unknown". */
  intentHints: AgentAction[];
  /** Matched hostile-instruction markers; advisory, never executable. */
  unsafeFlags: string[];
};

const USDC_DECIMALS = 6;
const BASE_CHAIN_ID = "8453";
const SUPPORTED_TOKEN = "usdc";
const ZERO_ADDRESS = "0x" + "0".repeat(40);

// ── Vocabularies ───────────────────────────────────────────────────────────

const PAY_VERBS = new Set([
  "pay",
  "send",
  "transfer",
  "reimburse",
  "give",
  "refund",
  "compensate",
  "wire",
  "tip",
]);

const CLAIM_WORDS = new Set(["claim", "claimpay", "claimlink"]);

const STATUS_WORDS = new Set(["status", "check", "receipt", "proof", "track", "verify", "inspect"]);

const UNSUPPORTED_TOKENS = new Set([
  "eth",
  "celo",
  "usdt",
  "cusd",
  "sol",
  "nim",
  "dai",
  "wbtc",
  "matic",
  "arb",
  "op",
  "bnb",
  "xlm",
  // Other crypto codes (whole-word only; "link"/"dot"/"ton" etc. are
  // deliberately NOT listed because they are ordinary English words).
  "btc",
  "xrp",
  "ltc",
  "ada",
  "doge",
  "xmr",
  "weth",
  "shib",
  "apt",
  "sui",
  "avax",
  // Fiat currency codes: never silently defaulted to USDC.
  "usd",
  "eur",
  "gbp",
  "jpy",
  "ngn",
  "cny",
  "inr",
  "krw",
  "chf",
  "aud",
  "cad",
  "sgd",
  "hkd",
  "nzd",
  "sek",
  "nok",
  "dkk",
  "zar",
  "brl",
  "mxn",
  "idr",
  "php",
  "thb",
  "vnd",
  "myr",
  "pln",
  "ils",
  "uah",
]);

/** Unsupported chains are captured as invalid candidates, never normalized. */
const UNSUPPORTED_CHAINS = new Set([
  "celo",
  "ethereum",
  "solana",
  "nimiq",
  "arbitrum",
  "polygon",
  "optimism",
  "avalanche",
  "binance",
  "bsc",
]);

const STOPWORDS = new Set([  "a",
  "an",
  "the",
  "for",
  "with",
  "of",
  "from",
  "and",
  "or",
  "me",
  "my",
  "i",
  "you",
  "your",
  "we",
  "our",
  "us",
  "can",
  "could",
  "would",
  "will",
  "should",
  "please",
  "now",
  "today",
  "later",
  "soon",
  "this",
  "that",
  "in",
  "on",
  "at",
  "via",
  "is",
  "are",
  "be",
  "it",
  "as",
  "by",
  "do",
  "does",
  "did",
  "want",
  "need",
  "like",
  "make",
  "link",
  "payment",
  "payout",
  "money",
  "funds",
  "create",
  "chain",
  "network",
  "mainnet",
  "use",
  "using",
  "then",
  "again",
]);

/**
 * Collective/pronoun words that must NEVER become recipient candidates:
 * "pay everyone 0.01 USDC" must not resolve to a claim link for
 * "everyone". Group/role language is either clarified or declined — never
 * turned into a payment or claim for a non-person.
 */
const GROUP_WORDS = new Set([
  "everyone",
  "everybody",
  "anyone",
  "anybody",
  "someone",
  "nobody",
  "contributors",
  "contributor",
  "team",
  "staff",
  "people",
  "members",
  "member",
  "crowd",
  "winners",
  "winner",
  "top",
  "all",
  "them",
  "him",
  "her",
]);

const UNSAFE_MARKERS: ReadonlyArray<{ pattern: RegExp; flag: string }> = [
  { pattern: /ignore (any |our |the |your |recipient )?(rules|policy)/i, flag: "ignore_policy" },
  { pattern: /skip (the )?approval/i, flag: "skip_approval" },
  { pattern: /bypass (the )?approval/i, flag: "bypass_approval" },
  { pattern: /bypass (the )?(limits|spending caps|policy)/i, flag: "bypass_approval" },
  { pattern: /override (the )?(daily |spending )?(cap|caps|limit|limits)|override (the )?(policy|approval)/i, flag: "bypass_approval" },
  { pattern: /without (an |any |owner )?approval/i, flag: "skip_approval" },
  { pattern: /execute (now|immediately|first|the payment|the transaction)/i, flag: "execute_now" },
  { pattern: /send (now|immediately|right now)/i, flag: "execute_now" },
  { pattern: /call keeperhub/i, flag: "keeperhub_call" },
  { pattern: /keeperhub directly/i, flag: "keeperhub_call" },
  { pattern: /\b(use|run) (raw )?sql\b|\bsql injection/i, flag: "sql_instruction" },
  { pattern: /post (a |an )?(url|request|to|a request)/i, flag: "url_instruction" },
  { pattern: /\buse webhook admin\b|\bwebhook admin\b/i, flag: "webhook_instruction" },
  { pattern: /drain (the |my |our )?wallet/i, flag: "drain_wallet" },
  { pattern: /mark (this |the |it |my )?(transaction|payment|payout)?\s*(as )?(successful|completed|done)/i, flag: "fabricate_success" },
  { pattern: /fake (a |the )?(transaction|tx|hash|receipt|proof)/i, flag: "fabricate_success" },
  { pattern: /approve (it|this|that) (yourself|for me)|approve (the |my )?(payment|payout|request) (yourself|for me)|self[- ]?approve/i, flag: "approve_self" },
];

// ── Local deterministic money grammar (mirror of keeperhub/amount.ts) ──────

export function canonicalizeAmountLocal(raw: string): string {
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

export function usdcToBaseUnitsLocal(canonical: string): string | null {
  const [whole, fraction = ""] = canonical.split(".");
  if (fraction.length > USDC_DECIMALS) return null;
  const wholeValue = BigInt(whole);
  const fractionValue = BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  const units = wholeValue * 10n ** BigInt(USDC_DECIMALS) + fractionValue;
  return units > 0n ? units.toString() : null;
}

// ── Scanner ────────────────────────────────────────────────────────────────

type ItemClass =
  | "address"
  | "url"
  | "uuid"
  | "number"
  | "word"
  | "token"
  | "chain"
  | "verb_pay"
  | "verb_claim"
  | "verb_status"
  | "to"
  | "stopword";

type Item = {
  raw: string;
  lower: string;
  index: number;
  klass: ItemClass;
};

const SCANNER_PATTERN =
  /(0x[0-9a-fA-F]{40})|(https?:\/\/[^\s]+)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})|(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9_-]*)/g;

function classifyWord(word: string): ItemClass {
  if (word === "to") return "to";
  const lower = word.toLowerCase();
  if (PAY_VERBS.has(lower)) return "verb_pay";
  if (CLAIM_WORDS.has(lower)) return "verb_claim";
  if (STATUS_WORDS.has(lower)) return "verb_status";
  if (lower === SUPPORTED_TOKEN || UNSUPPORTED_TOKENS.has(lower)) return "token";
  if (lower === "base" || UNSUPPORTED_CHAINS.has(lower)) return "chain";
  if (STOPWORDS.has(lower)) return "stopword";
  return "word";
}

function scanItems(text: string): Item[] {
  const items: Item[] = [];
  SCANNER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCANNER_PATTERN.exec(text)) !== null) {
    let klass: ItemClass = "word";
    let raw = match[0];
    if (match[1] !== undefined) {
      klass = "address";
    } else if (match[2] !== undefined) {
      klass = "url";
    } else if (match[3] !== undefined) {
      klass = "uuid";
    } else if (match[4] !== undefined) {
      klass = "number";
    } else if (match[5] !== undefined) {
      raw = match[5];
      let klass = classifyWord(raw);
      // A word that is both an unsupported token and an unsupported chain
      // (e.g. "celo") is a CHAIN when it follows "on" ("on Celo") and a
      // TOKEN otherwise ("pay 5 celo").
      if (klass === "token" && UNSUPPORTED_CHAINS.has(raw.toLowerCase())) {
        const previous = items[items.length - 1];
        if (previous !== undefined && previous.lower === "on") {
          klass = "chain";
        }
      }
      items.push({ raw, lower: raw.toLowerCase(), index: match.index, klass });
      continue;
    }
    items.push({ raw, lower: raw.toLowerCase(), index: match.index, klass });
  }
  return items;
}

// ── Candidate builders ─────────────────────────────────────────────────────

function pushUnique<T extends { raw: string }>(arr: T[], keyOf: (item: T) => string, item: T): void {
  const key = keyOf(item);
  if (!arr.some((existing) => keyOf(existing) === key)) arr.push(item);
}

function aliasContext(items: Item[], i: number): "pay_verb" | "to" | null {
  let distance = 0;
  for (let j = i - 1; j >= 0 && distance < 6; j -= 1, distance += 1) {
    const klass = items[j].klass;
    if (klass === "stopword" || klass === "token" || klass === "chain") continue;
    if (klass === "verb_pay") return "pay_verb";
    if (klass === "to") return "to";
    return null;
  }
  return null;
}

function nearestVerb(items: Item[], i: number): "pay" | "claim" | null {
  let distance = 0;
  for (let j = i - 1; j >= 0 && distance < 6; j -= 1, distance += 1) {
    const klass = items[j].klass;
    if (
      klass === "stopword" ||
      klass === "token" ||
      klass === "chain" ||
      klass === "number" ||
      klass === "word"
    ) {
      continue;
    }
    if (klass === "verb_pay") return "pay";
    if (klass === "verb_claim") return "claim";
    return null;
  }
  return null;
}

/**
 * Multi-recipient detection: a word following "and"/"or" after another
 * name, or following another name across a comma/ampersand gap, is itself a
 * recipient mention. This keeps "pay blossom and mike 0.01 USDC" AMBIGUOUS
 * instead of silently becoming a single payment to blossom, while ordinary
 * words after a name ("pay blossom about 0.01 USDC") stay out of the alias
 * set. Names not in the registry are still captured so the planner can
 * clarify rather than guess.
 */
function aliasChain(items: Item[], i: number, registry: ReadonlySet<string>, text: string): boolean {
  const previous = items[i - 1];
  if (previous === undefined) return false;
  if (previous.lower === "and" || previous.lower === "or") {
    const prior = items[i - 2];
    return prior !== undefined && prior.klass === "word" && registry.has(prior.lower);
  }
  // Comma/ampersand/slash adjacency: "blossom, endurance" or
  // "blossom/endurance" (these separators are scanner gaps, so the names
  // appear adjacent).
  const current = items[i];
  const gap = text.slice((previous.index ?? 0) + previous.raw.length, current.index);
  return previous.klass === "word" && registry.has(previous.lower) && /[,&/]/.test(gap);
}

// ── Main entry ─────────────────────────────────────────────────────────────

export function extractCandidates(text: string, workspaceAliases: readonly string[] = []): ExtractionResult {
  const candidates: PaymentCandidates = {
    amounts: [],
    tokens: [],
    chains: [],
    addresses: [],
    aliases: [],
    payoutIds: [],
    claimAmounts: [],
  };

  const intentHints: AgentAction[] = [];
  const unsafeFlags: string[] = [];

  for (const marker of UNSAFE_MARKERS) {
    if (marker.pattern.test(text)) {
      unsafeFlags.push(marker.flag);
    }
  }

  const items = scanItems(text);
  const registry = new Set(workspaceAliases.map((alias) => alias.toLowerCase()));

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];

    if (item.klass === "address") {
      const zero = item.lower === ZERO_ADDRESS;
      pushUnique(
        candidates.addresses,
        (c) => c.normalized ?? c.raw,
        {
          sourceField: "raw_address",
          raw: item.raw,
          normalized: item.lower,
          validationStatus: zero ? "invalid" : "valid",
        } as CandidateAddress,
      );
      continue;
    }

    if (item.klass === "url") {
      continue;
    }

    if (item.klass === "uuid") {
      pushUnique(
        candidates.payoutIds,
        (c) => c.normalized ?? c.raw,
        {
          sourceField: "raw_payout_id",
          raw: item.raw,
          normalized: item.lower,
          validationStatus: "valid",
        } as CandidatePayoutId,
      );
      continue;
    }

    if (item.klass === "number") {
      if (item.raw === BASE_CHAIN_ID) {
        pushUnique(
          candidates.chains,
          (c) => c.normalized ?? c.raw.toLowerCase(),
          {
            sourceField: "raw_chain",
            raw: item.raw,
            normalized: BASE_CHAIN_ID,
            validationStatus: "valid",
          } as CandidateChain,
        );
        continue;
      }
      // A number immediately preceded by a sign is a negative/positive
      // amount, and a number starting after a dot (".01") or comma ("0,01")
      // is a malformed decimal fragment — neither becomes a candidate (the
      // user is asked for a well-formed amount instead of a misread value).
      const previousChar = item.index > 0 ? text[item.index - 1] : "";
      if (previousChar === "-" || previousChar === "+" || previousChar === "." || previousChar === ",") continue;

      const associatedToken =
        items[i + 1] !== undefined && items[i + 1].klass === "token" ? items[i + 1].lower : null;
      const canonical = canonicalizeAmountLocal(item.raw);
      const canonicalOk = canonical !== "invalid" && canonical !== "0";
      const decimalsOk = canonicalOk ? (canonical.split(".")[1]?.length ?? 0) <= USDC_DECIMALS : false;
      const valid = canonicalOk && decimalsOk && (associatedToken === null || associatedToken === SUPPORTED_TOKEN);
      const target = nearestVerb(items, i) === "claim" ? candidates.claimAmounts : candidates.amounts;
      pushUnique(
        target,
        (c) => c.raw,
        {
          sourceField: "raw_amount",
          raw: item.raw,
          normalized: valid ? canonical : null,
          validationStatus: valid ? "valid" : "invalid",
          token: associatedToken,
          baseUnits: valid ? usdcToBaseUnitsLocal(canonical) : null,
        } as CandidateAmount | CandidateClaimAmount,
      );
      continue;
    }

    if (item.klass === "token") {
      const supported = item.lower === SUPPORTED_TOKEN;
      pushUnique(
        candidates.tokens,
        (c) => c.normalized ?? c.raw.toLowerCase(),
        {
          sourceField: "raw_token",
          raw: item.raw,
          normalized: item.lower,
          validationStatus: supported ? "valid" : "invalid",
        } as CandidateToken,
      );
      continue;
    }

    if (item.klass === "chain") {
      const supported = item.lower === "base";
      pushUnique(
        candidates.chains,
        (c) => c.normalized ?? c.raw.toLowerCase(),
        {
          sourceField: "raw_chain",
          raw: item.raw,
          normalized: supported ? BASE_CHAIN_ID : null,
          validationStatus: supported ? "valid" : "invalid",
        } as CandidateChain,
      );
      continue;
    }

    if (item.klass === "verb_pay") {
      if (!intentHints.includes("pay")) intentHints.push("pay");
      continue;
    }

    if (item.klass === "verb_claim") {
      if (!intentHints.includes("claim_pay")) intentHints.push("claim_pay");
      continue;
    }

    if (item.klass === "verb_status") {
      if (!intentHints.includes("status")) intentHints.push("status");
      continue;
    }

    if (item.klass === "word") {
      if (item.lower.length < 2) continue;
      if (GROUP_WORDS.has(item.lower)) continue;
      const inRegistry = registry.has(item.lower);
      const context = inRegistry ? "pay_verb" : aliasContext(items, i);
      if (context !== null || aliasChain(items, i, registry, text)) {
        pushUnique(
          candidates.aliases,
          (c) => c.normalized ?? c.raw,
          {
            sourceField: "raw_alias",
            raw: item.raw,
            normalized: item.lower,
            validationStatus: "valid",
          } as CandidateAlias,
        );
      }
      continue;
    }
  }

  return { candidates, intentHints, unsafeFlags };
}

// ── Memo (display-only reason phrase) ───────────────────────────────────────

/** Mirrors the intent schema's 140-char memo cap (schema.ts). */
export const MAX_MEMO_CHARS = 140;

/**
 * Memo markers: "for", "memo", "note" (with optional colon) and the em dash.
 * The LAST marker in the text wins, so the reason phrase is whatever follows
 * the payment fields. Display-only and never authoritative: it can never
 * affect amount, recipient, policy, approval, or execution.
 */
const MEMO_MARKER_PATTERN = /\b(?:for|memo|note)\b\s*:?|—/gi;

/**
 * Deterministic memo extraction: the trimmed text after the last marker,
 * scrubbed of secret-shaped content and capped at the schema's 140 chars.
 * Returns null when no marker or no content follows it. Pure and local —
 * no I/O, no candidates involved.
 */
export function extractMemo(rawText: string): string | null {
  const markers = [...rawText.matchAll(MEMO_MARKER_PATTERN)];
  if (markers.length === 0) return null;
  const last = markers[markers.length - 1];
  const markerIndex = last.index ?? 0;
  // A memo marker only counts AFTER the payment fields: require at least one
  // digit (amount) before the marker, so a leading "for design work, pay
  // blossom 0.01 USDC" cannot swallow the instruction into the memo.
  if (!/\d/.test(rawText.slice(0, markerIndex))) return null;
  const candidate = rawText.slice(markerIndex + last[0].length).trim();
  if (candidate.length === 0) return null;
  const redacted = redactAgentRawText(candidate);
  const memo = redacted.length > MAX_MEMO_CHARS ? redacted.slice(0, MAX_MEMO_CHARS) : redacted;
  return memo.length === 0 ? null : memo;
}

// ── M10 batch parsing (intent recognition only — no persistence) ───────────

export type BatchRecipientParse = {
  label: string;
  address: string | null;
  /** True when an alias is not in the workspace registry. */
  unresolved: boolean;
};

export type BatchParseOutcome =
  | {
      status: "batch";
      mode: "uniform_each" | "split_equal" | "explicit_amounts";
      recipients: BatchRecipientParse[];
      /** Per-recipient base units, aligned with `recipients`. */
      amountsBaseUnits: string[];
      totalAmountBaseUnits: string;
      memo: string | null;
    }
  | { status: "clarify"; missingFields: MissingFieldKey[] }
  | { status: "none" };

const MAX_BATCH_RECIPIENTS = 10;
const BATCH_SPLIT_WORDS = new Set(["split", "divide"]);
const BATCH_BETWEEN_WORDS = new Set(["between", "among"]);

function isNameItem(item: Item): boolean {
  return item.klass === "word" || item.klass === "address";
}

/** "and"/"or" are stopword-classified in the scanner. */
function isBatchSeparator(item: Item): boolean {
  return (item.klass === "word" || item.klass === "stopword") && (item.lower === "and" || item.lower === "or");
}

function batchRecipientFor(item: Item, registry: ReadonlySet<string>): BatchRecipientParse {
  if (item.klass === "address") {
    return { label: item.raw, address: item.lower, unresolved: false };
  }
  return { label: item.lower, address: null, unresolved: !registry.has(item.lower) };
}

/**
 * Parses a recipient name sequence starting at `start`: names separated by
 * "and"/"or" words or by comma/ampersand/slash gaps. Stops at the first
 * non-name, non-separator item. Never resolves addresses — it only reports
 * which names are registry aliases.
 */
function parseBatchNames(
  items: Item[],
  start: number,
  registry: ReadonlySet<string>,
  text: string,
): { recipients: BatchRecipientParse[]; end: number } {
  const recipients: BatchRecipientParse[] = [];
  let i = start;
  while (i < items.length) {
    const item = items[i];
    if (!isNameItem(item)) break;
    recipients.push(batchRecipientFor(item, registry));
    i += 1;
    const next = items[i];
    if (next === undefined) break;
    if (isBatchSeparator(next)) {
      i += 1;
      continue;
    }
    if (isNameItem(next)) {
      const gap = text.slice(item.index + item.raw.length, next.index);
      if (/[,&/]/.test(gap)) continue;
    }
    break;
  }
  return { recipients, end: i };
}

/** True when every recipient resolves (registry alias or explicit address). */
function batchAllResolved(recipients: readonly BatchRecipientParse[]): boolean {
  return recipients.every((recipient) => !recipient.unresolved);
}

function batchHasDuplicates(recipients: readonly BatchRecipientParse[]): boolean {
  const seen = new Set<string>();
  for (const recipient of recipients) {
    const key = recipient.address ?? recipient.label;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function batchAmountToBaseUnits(raw: string): string | null {
  const canonical = canonicalizeAmountLocal(raw);
  if (canonical === "invalid" || canonical === "0") return null;
  return usdcToBaseUnitsLocal(canonical);
}

/** Numbers after a dot/comma/sign are malformed decimal fragments — never parsed. */
function batchNumberMalformed(item: Item, text: string): boolean {
  const previousChar = item.index > 0 ? text[item.index - 1] : "";
  return previousChar === "." || previousChar === "," || previousChar === "-" || previousChar === "+";
}

/**
 * Deterministic M10 v1 batch intent recognition. Recognizes ONLY the
 * explicit grammar (G1 "each", G2 "split/divide … between/among", G3
 * per-recipient amount pairs). Everything else returns "none" so the
 * caller's existing single-recipient/ambiguity logic applies unchanged —
 * a multi-recipient phrase can never become a single-recipient payment.
 */
export function parseBatchPayment(text: string, aliases: readonly string[]): BatchParseOutcome {
  const registry = new Set(aliases.map((alias) => alias.toLowerCase()));
  const items = scanItems(text);
  if (items.length === 0) return { status: "none" };

  const verbIdx = items.findIndex((item) => item.klass === "verb_pay");
  const eachIdx = items.findIndex((item) => item.klass === "word" && item.lower === "each");
  const splitIdx = items.findIndex((item) => item.klass === "word" && BATCH_SPLIT_WORDS.has(item.lower));

  // G2 — split/divide <total> USDC [equally] between/among <names>
  if (splitIdx >= 0 && verbIdx < 0) {
    const number = items[splitIdx + 1];
    if (number === undefined || number.klass !== "number") return { status: "none" };
    if (batchNumberMalformed(number, text)) return { status: "clarify", missingFields: ["amount"] };
    const total = batchAmountToBaseUnits(number.raw);
    if (total === null) return { status: "clarify", missingFields: ["amount"] };
    let betweenIdx = splitIdx + 1;
    while (betweenIdx < items.length) {
      const item = items[betweenIdx];
      if (item.klass === "word" && BATCH_BETWEEN_WORDS.has(item.lower)) break;
      betweenIdx += 1;
    }
    if (betweenIdx >= items.length) return { status: "none" };
    const { recipients } = parseBatchNames(items, betweenIdx + 1, registry, text);
    if (recipients.length < 2) return { status: "none" };
    if (recipients.length > MAX_BATCH_RECIPIENTS) return { status: "clarify", missingFields: ["recipient"] };
    if (!batchAllResolved(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    if (batchHasDuplicates(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    const totalUnits = BigInt(total);
    if (totalUnits % BigInt(recipients.length) !== 0n) {
      return { status: "clarify", missingFields: ["amount"] };
    }
    const perRecipient = (totalUnits / BigInt(recipients.length)).toString();
    return {
      status: "batch",
      mode: "split_equal",
      recipients,
      amountsBaseUnits: recipients.map(() => perRecipient),
      totalAmountBaseUnits: total,
      memo: extractMemo(text),
    };
  }

  // G1 — <verb> <names> <amount> USDC each | <verb> <amount> USDC each to <names>
  if (eachIdx >= 0 && verbIdx >= 0) {
    const allNumbers = items.filter((item) => item.klass === "number");
    const numbers = allNumbers.filter((item) => !batchNumberMalformed(item, text));
    if (allNumbers.length > 0 && numbers.length === 0) {
      return { status: "clarify", missingFields: ["amount"] };
    }
    if (numbers.length !== 1) return { status: "none" };
    const amount = batchAmountToBaseUnits(numbers[0].raw);
    if (amount === null) return { status: "clarify", missingFields: ["amount"] };
    const numberIdx = items.indexOf(numbers[0]);
    let recipients: BatchRecipientParse[] = [];
    if (numberIdx > verbIdx + 1) {
      const before = parseBatchNames(items, verbIdx + 1, registry, text);
      if (before.end === numberIdx) recipients = before.recipients;
    }
    if (recipients.length === 0) {
      const toIdx = items.findIndex((item, index) => index > eachIdx && item.klass === "to");
      if (toIdx >= 0) {
        recipients = parseBatchNames(items, toIdx + 1, registry, text).recipients;
      }
    }
    if (recipients.length < 2) return { status: "none" };
    if (recipients.length > MAX_BATCH_RECIPIENTS) return { status: "clarify", missingFields: ["recipient"] };
    if (!batchAllResolved(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    if (batchHasDuplicates(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    return {
      status: "batch",
      mode: "uniform_each",
      recipients,
      amountsBaseUnits: recipients.map(() => amount),
      totalAmountBaseUnits: (BigInt(amount) * BigInt(recipients.length)).toString(),
      memo: extractMemo(text),
    };
  }

  // G3 — <verb> <name> <amount> [USDC] (and|,) <name> <amount> [USDC] …
  //       <verb> <amount> [USDC] to <name> (and|,) <amount> [USDC] to <name> …
  if (verbIdx >= 0) {
    const recipients: BatchRecipientParse[] = [];
    const amounts: string[] = [];
    let i = verbIdx + 1;
    let ok = true;
    while (i < items.length) {
      const item = items[i];
      if (isBatchSeparator(item)) {
        i += 1;
        continue;
      }
      if (isNameItem(item)) {
        recipients.push(batchRecipientFor(item, registry));
        i += 1;
        const number = items[i];
        if (number === undefined || number.klass !== "number" || batchNumberMalformed(number, text)) {
          ok = false;
          break;
        }
        amounts.push(number.raw);
        i += 1;
        if (items[i] !== undefined && items[i].klass === "token") i += 1;
        continue;
      }
      if (item.klass === "number") {
        if (batchNumberMalformed(item, text)) {
          ok = false;
          break;
        }
        amounts.push(item.raw);
        i += 1;
        if (items[i] !== undefined && items[i].klass === "token") i += 1;
        const to = items[i];
        if (to === undefined || to.klass !== "to") {
          ok = false;
          break;
        }
        i += 1;
        const name = items[i];
        if (name === undefined || !isNameItem(name)) {
          ok = false;
          break;
        }
        recipients.push(batchRecipientFor(name, registry));
        i += 1;
        continue;
      }
      break;
    }
    if (!ok || recipients.length < 2) return { status: "none" };
    if (recipients.length > MAX_BATCH_RECIPIENTS) return { status: "clarify", missingFields: ["recipient"] };
    const amountsBaseUnits: string[] = [];
    for (const raw of amounts) {
      const units = batchAmountToBaseUnits(raw);
      if (units === null) return { status: "clarify", missingFields: ["amount"] };
      amountsBaseUnits.push(units);
    }
    if (!batchAllResolved(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    if (batchHasDuplicates(recipients)) return { status: "clarify", missingFields: ["recipient"] };
    const total = amountsBaseUnits.reduce((sum, units) => sum + BigInt(units), 0n);
    return {
      status: "batch",
      mode: "explicit_amounts",
      recipients,
      amountsBaseUnits,
      totalAmountBaseUnits: total.toString(),
      memo: extractMemo(text),
    };
  }

  return { status: "none" };
}
