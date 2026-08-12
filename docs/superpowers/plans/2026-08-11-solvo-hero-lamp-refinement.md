# Solvo Hero Lamp Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the reference hero's separated SOLVO lettering, long realistic pendant lamp, visible illumination, and stronger top-left S without changing landing content or product behavior.

**Architecture:** Keep SOLVO as semantic HTML in `GhostWordmark`; replace only the landing lamp illustration with a generated raster asset consumed by `Lamp`. Use existing hero layers and responsive breakpoints, adding focused CSS only where image/text overlap must be controlled.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Node test runner, generated raster image asset.

## Global Constraints

- The center text is exactly `SOLVO`.
- Preserve the navigation labels, routes, execution-strip copy, lower sections, and all backend behavior.
- Use the monochrome tokens from `DESIGN.md`; the lamp is the only bright visual element.
- Do not stage, commit, or rewrite unrelated dirty-worktree changes.
- The generated lamp asset contains no text and is decorative in the rendered hero.

---

### Task 1: Generate and inspect the pendant-lamp asset

**Files:**
- Create: `public/images/solvo-pendant-lamp.png`

**Interfaces:**
- Produces: a monochrome raster asset with a ceiling mount, long cable, curved loop/jog, compact dome shade, touching bulb, restrained bloom, and downward light cone; no text.

- [ ] Generate the asset from the supplied `ui.jpg`, matching its fixture geometry and charcoal palette.
- [ ] Inspect the saved asset at original resolution for cable continuity, clean edges, centered bulb, and absence of lettering or unrelated objects.
- [ ] Record its pixel dimensions and focal point for the component implementer.

### Task 2: Add failing hero visual contracts

**Files:**
- Modify: `tests/ui/landing-source.test.ts`
- Modify: `tests/ui/shared-shell-source.test.ts`

**Interfaces:**
- Consumes: expected asset path `/images/solvo-pendant-lamp.png`.
- Produces: contracts requiring the raster lamp, wide separated ghost word, and enlarged top-left S.

- [ ] Add an assertion that the landing lamp component references `/images/solvo-pendant-lamp.png` and the old hero SVG is not rendered.
- [ ] Add an assertion that `GhostWordmark` renders literal `SOLVO` with tracking of at least `0.24em` and a reference-like muted ghost color.
- [ ] Add an assertion that the home mark retains `aria-label="Solvo home"` and uses a font size of at least 14px.
- [ ] Run `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts` and confirm the new assertions fail before implementation.

### Task 3: Implement the lamp, illuminated word, and brand mark

**Files:**
- Modify: `src/components/Lamp.tsx`
- Modify: `src/components/GhostWordmark.tsx`
- Modify: `src/components/SiteNav.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `/images/solvo-pendant-lamp.png`.
- Produces: `Lamp({ className?: string })`, retaining the existing public component signature.

- [ ] Replace the handcrafted SVG with `next/image`, mark it decorative, and preserve caller-controlled sizing through `className`.
- [ ] Give the ghost word reference-like separated lettering with explicit wide tracking, medium/semibold weight, muted charcoal color, and stable single-line layout.
- [ ] Reposition the lamp/word layers so the shade hangs above the center letters and the light cone overlaps them at 800×600 and 1920×1080.
- [ ] Enlarge the top-left S to 15px–16px while preserving the home link, focus styling, and minimum 44px target.
- [ ] Retain compact behavior at 390×844 and 844×390 without clipping or covering the execution strip.
- [ ] Run the focused source tests and confirm they pass.

### Task 4: Verify visual fidelity and regression safety

**Files:**
- Modify: `design-qa.md`
- Create: viewport captures under the existing design-QA evidence directory.

**Interfaces:**
- Consumes: the running landing page and both supplied screenshots.
- Produces: evidence and a QA verdict for this refinement.

- [ ] Run `node --test tests/ui` and record the exact passing count.
- [ ] Run `npm run lint`.
- [ ] Run `npx tsc --noEmit` and `npm run build`; separate unrelated server/test failures from UI results.
- [ ] Capture `/` at 800×600, 1920×1080, 390×844, and 844×390.
- [ ] Compare the 800×600 capture directly with `ui.jpg` for cable shape, shade, bulb, rays, word spacing, weight, color, and mark size.
- [ ] Compare the 1920×1080 capture with `Screenshot (1397).png` and verify every requested mismatch is materially corrected.
- [ ] Check keyboard focus, reduced motion, no horizontal overflow, and no console/runtime errors introduced by the hero.
- [ ] Update `design-qa.md` with observed differences and use `final result: passed` only if no P0–P2 issue remains.
