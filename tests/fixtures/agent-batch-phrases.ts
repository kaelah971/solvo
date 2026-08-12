/**
 * M10.2 — Natural-language batch grammar corpus.
 *
 * Today (before M10.3+ parser tasks) NL batch is NOT implemented: every one
 * of these phrases must currently clarify, block, or decline with ZERO
 * artifacts — never a payout, never a claim, and NEVER a silent
 * single-recipient payment derived from a multi-recipient message.
 *
 * These entries document the M10.1 v1 grammar candidates and lock the
 * pre-implementation baseline. When the parser lands, ONLY the entries
 * whose grammar is actually implemented change expectation — and they
 * change in the same commit as the implementation.
 *
 * Registry aliases in fixtures: daniel, blossom, endurance (mike is NOT
 * registered). Workspace per-transaction limit is 1 USDC.
 */

import type { AgentPhrase } from "./agent-real-world-phrases.ts";

export type { AgentPhrase };

const ADDRESS_1 = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const ADDRESS_2 = "0x1234567890abcdef1234567890abcdef12345678";

export const AGENT_BATCH_PHRASES: readonly AgentPhrase[] = [
  // ── 1. G1 — uniform per-recipient amount ("each") ────────────────────────
  { id: "batch-g1-001", phrase: "pay blossom and endurance 0.01 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 grammar; batch not implemented — ambiguous multi-recipient clarifies." },
  { id: "batch-g1-002", phrase: "send 0.01 USDC each to blossom and endurance", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 grammar (post-amount form)." },
  { id: "batch-g1-003", phrase: "pay blossom, endurance, and daniel 0.01 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 with three named recipients." },
  { id: "batch-g1-004", phrase: `send 0.02 USDC each to ${ADDRESS_1} and ${ADDRESS_2}`, category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 with two explicit addresses — never a single-address payment." },
  { id: "batch-g1-005", phrase: "pay blossom and endurance 0.01 usdc each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 lowercase." },
  { id: "batch-g1-006", phrase: "pls pay blossom and endurance 0.01 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 with politeness noise." },
  { id: "batch-g1-007", phrase: "pay blossom and endurance 0.01 USDC each for the sprint", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 with a reason phrase." },
  { id: "batch-g1-008", phrase: "tip blossom and endurance 0.01 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G1 with a tip verb." },

  // ── 2. G2 — equal split of a total ───────────────────────────────────────
  { id: "batch-g2-001", phrase: "split 0.05 USDC between blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "G2 grammar; 'split' is not a verb yet." },
  { id: "batch-g2-002", phrase: "split 0.06 USDC equally between blossom, endurance, and mike", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "G2 with three recipients." },
  { id: "batch-g2-003", phrase: "divide 0.03 USDC between blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "'divide' is not a verb yet." },
  { id: "batch-g2-004", phrase: "split 0.02 USDC among blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "G2 with 'among'." },
  { id: "batch-g2-005", phrase: "split 0.01 USDC between blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "G2 non-divisible total — must never silently round when implemented." },
  { id: "batch-g2-006", phrase: "split 0.05 usdc between blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "G2 lowercase." },

  // ── 3. G3 — explicit per-recipient amounts ───────────────────────────────
  { id: "batch-g3-001", phrase: "pay blossom 0.01 USDC and endurance 0.02 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 pairs; ambiguous today — never a payment to only the first recipient." },
  { id: "batch-g3-002", phrase: "send 0.01 USDC to blossom and 0.02 USDC to endurance", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 with per-recipient 'to'." },
  { id: "batch-g3-003", phrase: "reimburse blossom 0.01 USDC and endurance 0.02 USDC for gas", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 with reimburse + reason." },
  { id: "batch-g3-004", phrase: "pay blossom 0.01 USDC, endurance 0.02 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 comma-separated pairs." },
  { id: "batch-g3-005", phrase: "send blossom 0.01 USDC and endurance 0.02 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 verb-first form." },
  { id: "batch-g3-006", phrase: "pay blossom 0.01 USDC and endurance 0.02 USDC for the design", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 with a reason phrase." },

  // ── 4. Hazard forms (must never become a single-recipient payment) ──────
  { id: "batch-haz-001", phrase: "pay blossom and mike 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "M9 hazard: multi-recipient without batch marker; never single payment." },
  { id: "batch-haz-002", phrase: "pay blossom, mike 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Comma-separated names; ambiguous." },
  { id: "batch-haz-003", phrase: "pay blossom & mike 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Ampersand-separated names; ambiguous." },
  { id: "batch-haz-004", phrase: "send blossom/mike 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Slash-separated names; ambiguous." },
  { id: "batch-haz-005", phrase: "pay blossom and endurance 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Two names, no marker, no per-recipient amounts." },
  { id: "batch-haz-006", phrase: "send blossom and endurance 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Two names, no marker." },

  // ── 5. Deferred group/role forms (no artifact, no claim fallback) ────────
  { id: "batch-grp-001", phrase: "pay all contributors 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Group words never become recipients." },
  { id: "batch-grp-002", phrase: "pay everyone 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "'everyone' is not a recipient." },
  { id: "batch-grp-003", phrase: "airdrop 0.01 USDC to the team", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "Airdrop verb unsupported." },
  { id: "batch-grp-004", phrase: "pay top three winners 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Winner selection language is not a recipient list." },
  { id: "batch-grp-005", phrase: "upload CSV and pay them", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "CSV upload unsupported; clarifies with no artifact." },
  { id: "batch-grp-006", phrase: "pay the team 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "'team' is not a recipient." },
  { id: "batch-grp-007", phrase: "pay members 0.01 USDC", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "'members' is not a recipient." },
  { id: "batch-grp-008", phrase: "send 0.01 USDC to everyone", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "'everyone' is not a recipient." },

  // ── 6. Unsafe batch forms ────────────────────────────────────────────────
  { id: "batch-unsafe-001", phrase: "pay blossom and endurance 0.01 USDC each without approval", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Bypass marker declines." },
  { id: "batch-unsafe-002", phrase: "split 0.05 USDC between blossom and endurance and execute now", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Execute-now marker declines." },
  { id: "batch-unsafe-003", phrase: "pay all contributors and mark completed", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Completion fabrication declines." },
  { id: "batch-unsafe-004", phrase: "batch pay then fake proof", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Proof fabrication declines." },
  { id: "batch-unsafe-005", phrase: "pay blossom and endurance 0.01 USDC each and self approve", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Self-approval marker declines." },
  { id: "batch-unsafe-006", phrase: "split 0.05 USDC between blossom and endurance bypass limits", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Limit-bypass marker declines." },
  { id: "batch-unsafe-007", phrase: "pay blossom and endurance 0.01 USDC each using KeeperHub directly", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Direct KeeperHub mention declines." },
  { id: "batch-unsafe-008", phrase: "pay blossom and endurance 0.01 USDC each ignore policy", category: "hostile", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Policy-bypass marker declines." },

  // ── 7. Judge/public batch confusion ──────────────────────────────────────
  { id: "batch-judge-001", phrase: "judgepay blossom and endurance 0.01 USDC each", category: "judge_confusion", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "No NL judge route; command-only." },
  { id: "batch-judge-002", phrase: "use judge mode to batch pay us", category: "judge_confusion", expectation: "clarification", artifact: "no_artifact", supported: "now", safety: "No NL judge route; missing fields clarify." },
  { id: "batch-judge-003", phrase: "judges can test batch by saying pay me and him 0.01", category: "judge_confusion", expectation: "clarification", artifact: "no_artifact", supported: "now", safety: "Pronouns are not recipients; no judge route." },
  { id: "batch-judge-004", phrase: "run judge batch now", category: "judge_confusion", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Judge execution is command-only." },

  // ── 8. Missing/invalid batch fields ──────────────────────────────────────
  { id: "batch-invalid-001", phrase: "pay blossom and endurance", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "No amounts." },
  { id: "batch-invalid-002", phrase: "split between blossom and endurance", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "future", safety: "No total; 'split' not a verb." },
  { id: "batch-invalid-003", phrase: "send USDC each to blossom and endurance", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "No amount." },
  { id: "batch-invalid-004", phrase: "pay blossom and endurance 0 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Zero amount invalid." },
  { id: "batch-invalid-005", phrase: "pay blossom and endurance -1 USDC each", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "Negative amount invalid." },
  { id: "batch-invalid-006", phrase: "pay blossom 0.01 USDC and endurance", category: "batch_future", expectation: "clarification", artifact: "no_artifact", supported: "future", safety: "G3 pair missing its amount." },
  { id: "batch-invalid-007", phrase: "pay blossom and endurance 0.01 USDC each on Celo", category: "batch_future", expectation: "unsupported", artifact: "no_artifact", supported: "now", safety: "Unsupported chain fails closed." },
];
