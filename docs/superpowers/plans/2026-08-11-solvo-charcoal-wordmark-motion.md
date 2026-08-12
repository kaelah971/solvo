# Solvo Charcoal, Wordmark, and Living-Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's black appearance with the reference's charcoal atmosphere, correct both SOLVO wordmarks proportionally to the lamp, and add a subtle continuous eight-second light sweep.

**Architecture:** Keep the existing semantic `Wordmark` and `GhostWordmark` components and lamp raster. Express the palette and motion through scoped CSS tokens/classes; render the moving highlight as a clipped duplicate text layer or pseudo-element so only transform/opacity animate.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, CSS keyframes, Node test runner.

## Global Constraints

- The central product text remains exactly `SOLVO`.
- The large word grows approximately 8% and gains only a small optical-weight increase.
- The small word uses approximately 13px type, medium weight, `0.48em` tracking, and muted gray near `#9a9ca0`.
- The substrate is a continuous charcoal field, approximately `#2b2e32` in the hero center and `#17191c` at the edges; no black gutters or black inner rectangle.
- The sweep repeats every eight seconds, moves left to right, uses transform/opacity only, never turns the full word white, and is removed under `prefers-reduced-motion`.
- Preserve the lamp asset, navigation, copy, execution strip, lower content, routes, and backend behavior.
- Do not stage, commit, or overwrite unrelated dirty-worktree changes.

---

### Task 1: Add red visual contracts

**Files:**
- Modify: `tests/ui/landing-source.test.ts`
- Modify: `tests/ui/shared-shell-source.test.ts`

**Interfaces:**
- Produces: source contracts for the final palette, wordmark proportions, continuous sweep, and reduced-motion handling.

- [ ] Add a scoped contract that resolves the small `Wordmark` styling and requires 12–14px type, at least `0.44em` tracking, medium weight, and an approved muted gray value rather than primary white.
- [ ] Add a scoped contract that resolves the large `GhostWordmark` styling and requires the approximately 8% scale increase, separated tracking, and the approved muted resting color.
- [ ] Add a contract that reads `globals.css`, resolves `.site-substrate`, and requires a continuous charcoal field whose brightest hero value is in the `#282b2f`–`#303338` range and whose edge value is in the `#15171a`–`#1b1d20` range, with no `#000`/`black` landing plane.
- [ ] Add a contract requiring an eight-second infinite left-to-right sweep on the large word, using transform/opacity keyframes and no animated layout property, filter, or tracking.
- [ ] Add a contract requiring the sweep and lamp breathing to be disabled inside `prefers-reduced-motion: reduce`.
- [ ] Run `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts` and confirm the new tests fail only for the unimplemented palette/type/motion requirements.

### Task 2: Implement palette, proportional type, and living light

**Files:**
- Modify: `src/components/Wordmark.tsx`
- Modify: `src/components/GhostWordmark.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Preserves: `Wordmark({ className?: string })` and `GhostWordmark({ className?: string, "aria-hidden"?: boolean })`.
- Produces: `.ghost-wordmark`, `.ghost-wordmark-sweep`, and eight-second `@keyframes` styling scoped to the landing hero.

- [ ] Lift the landing/global substrate to a continuous charcoal radial field centered around `#2b2e32` and falling to approximately `#17191c`; keep panels/hairlines within the existing monochrome system.
- [ ] Restyle the small visible `SOLVO` to 13px, medium weight, `0.48em` tracking, muted gray near `#9a9ca0`, and a lamp-proportional vertical gap.
- [ ] Increase the large `SOLVO` from the current responsive size by approximately 8%, retain at least `0.24em` tracking, and apply the slight approved weight increase while keeping the resting color muted.
- [ ] Add one decorative, accessibility-hidden sweep layer aligned exactly over the large word. Clip it to the glyphs and animate one narrow highlight band left-to-right every eight seconds using only `transform` and `opacity`.
- [ ] Keep the lamp breathing continuous; ensure the sweep and breathing do not share or overwrite the same `animation` declaration.
- [ ] Disable the sweep and breathing under reduced motion, leaving the resting word appearance visible.
- [ ] Preserve current mobile and short-landscape layout without wrapping the foreground wordmark or covering the copy/strip.
- [ ] Run the focused tests until all pass, then run targeted ESLint and `npx.cmd tsc --noEmit`; record unrelated concurrent failures separately.

### Task 3: Browser fidelity and motion QA

**Files:**
- Modify: `design-qa.md`
- Create: captures/comparisons under the existing design-QA evidence directory.

**Interfaces:**
- Consumes: `ui.jpg`, `Screenshot (1402).png`, and the running local landing page.
- Produces: final static and mid-sweep evidence plus a blocking QA verdict.

- [ ] Run the complete UI source suite, lint, type check, and Next build; record exact counts/results.
- [ ] Capture `/` at 800×600, 1920×1080, 390×844, and 844×390 using the Codex in-app Browser.
- [ ] Capture the large word at a resting frame and a mid-sweep frame; verify the animation repeats after eight seconds and remains confined to the large word.
- [ ] Compare `ui.jpg` and the 800×600 implementation in one normalized input for background value, large-word scale/weight, small-word scale/tracking/color, lamp proportions, and hierarchy.
- [ ] Compare `Screenshot (1402).png` and the 1920×1080 implementation to verify the flat-black appearance and overly white/compact small word are gone.
- [ ] Verify mobile/short-landscape overflow, console/runtime errors, visible focus, and reduced-motion CSS behavior.
- [ ] Update `design-qa.md` with comparison history and use `final result: passed` only when no actionable P0–P2 issue remains; otherwise report `blocked` with exact fixes.
