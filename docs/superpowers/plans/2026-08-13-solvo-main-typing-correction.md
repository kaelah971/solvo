# Solvo Main Typing Correction Implementation Plan

**Goal:** Move the repetitive typing animation from the small SOLVO to the oversized main SOLVO while restoring the static centered sub-word and preserving the lamp exactly.

### Task 1: Correct regression contracts

Modify `tests/ui/landing-source.test.ts` first. Require the large main word to own the type/delete animation and cursor; require the small sub-word to be static, fully written, centered below, and free of cursor/typing hooks; require the approved lamp source and geometry classes to remain unchanged; require a desktop-dominant large font and fixed footprint; preserve timing, explicit boundaries, accessibility, and reduced-motion behavior. Run focused tests and confirm intended red failures only.

### Task 2: Correct the hero implementation

Modify only `src/components/HeroTypingWordmark.tsx`, `src/components/GhostWordmark.tsx`, `src/app/page.tsx`, and `src/app/globals.css`. Make the large layer the fixed-footprint animated layer, make the small layer a static centered SOLVO below it, and restore/preserve the approved lamp without editing `Lamp.tsx` or the image. Run focused tests, lint, and TypeScript.

### Task 3: Visual QA

Verify all four target viewports and multiple animation phases in the in-app Browser. Compare references, confirm the lamp and sub-word do not move, confirm desktop scale, update `design-qa.md`, and run final focused tests/lint/typecheck/build.

