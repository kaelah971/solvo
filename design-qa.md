# Design QA — Solvo main-word typing correction

- Source visual truth: `C:/Users/emman/Downloads/Telegram Desktop/ui.jpg` (800 x 600), plus the user-supplied `Screenshot (1421).png` and `Screenshot (1422).png`.
- Implementation: `http://127.0.0.1:3000/` in the Codex in-app Browser.
- Evidence directory: `C:/Users/emman/.codex/visualizations/2026/08/11/019fee41-9800-7e52-80b5-108c273f7334/design-qa/main-typing-correction/`.
- CSS viewports: 800 x 600, 1920 x 1080, 390 x 844, and 844 x 390 at deviceScaleFactor 1. The in-app Browser chrome reduced captured page pixels to 785 x 589, 1905 x 977, 375 x 811, and 829 x 383 respectively; DOM measurements confirmed the requested CSS viewport dimensions.
- States: empty, mid-type, full, mid-delete, empty-after-delete, and repeat at every viewport.
- Full-view comparison: `comparison-ui-vs-800x600-corrected-full.png` (reference and implementation normalized to 800 x 600).
- Focused evidence: phase-by-phase computed styles and bounding boxes for the main word, cursor, sub-word, lamp, descriptor, strip, and document overflow. Separate crops were unnecessary because the hero typography and lamp are legible in the full-resolution captures and were also measured in the DOM.

**Findings**

- No remaining P0, P1, or P2 findings.

**Required fidelity surfaces**

- Fonts and typography: the large 650-weight, 0.28em-tracked SOLVO is the dominant desktop word (542.05 x 101.09px at 1920 x 1080). The small sub-SOLVO is always complete at 13px, 0.48em tracking, regular weight, and near-white `rgb(232,232,232)`.
- Spacing and layout rhythm: both words share one horizontal center. The main shell, static sub-word, lamp, descriptor, and execution strip keep identical bounding boxes across every captured animation phase. The full word scales responsively and remains prominent on desktop.
- Colors and tokens: the charcoal substrate, low-contrast large word, near-white sub-word, hairlines, and quiet supporting copy preserve the approved monochrome visual hierarchy.
- Image quality and asset fidelity: the approved raster `/images/solvo-pendant-lamp-v3.png` loads successfully; `Lamp.tsx`, the asset, intrinsic dimensions, responsive widths, center, and hero position have no source diff.
- Copy and content: SOLVO, the descriptor, navigation, and execution-strip text are unchanged and coherent.
- Interaction and motion: the 3.3-second sequence repeats through type, hold, erase, and empty pause. The cursor is anchored to the same measured reveal edge; its full-state gap from the final O edge is 0px at 1920 and sub-pixel at every other viewport. The repeat capture shows a new cycle beginning.
- Responsive behavior: no horizontal document overflow at any required viewport. Mobile uses the working menu; short landscape retains the single-row strip and centered lockup.
- Accessibility: the stable `sr-only` Solvo h1 remains, animated typography is decorative, cursor is hidden and the complete large word is shown under reduced-motion rules, and the small word remains complete. The mobile menu opens with correct `aria-expanded` state and a visible off-white focus outline.
- Console: no warnings or errors were recorded after the final reload and mobile-menu interaction.

**Comparison history**

1. Initial corrected-hierarchy pass: the large typing word and centered static sub-word were correct, but a P1 cursor overshoot remained. The cursor sat 116.13px beyond the final O at 1920 x 1080 and 55.82px beyond it at 800 x 600.
2. Fix: reveal and cursor were unified on the measured cumulative glyph boundaries `[0.947, 2.005, 2.821, 3.768, 4.826]em`; the independent inaccurate transform track was removed.
3. Post-fix evidence: all phases were recaptured at all four viewports. The cursor now stays on the reveal edge at every measured boundary, the full-state gap is effectively 0px, and all fixed-layout constraints remain stable. See the `*-corrected-*.png` captures and corrected combined comparison.

**Verification**

- Focused UI tests: 37 total, 35 passed, 2 obsolete sweep tests skipped, 0 failed.
- ESLint: exit 0; three non-blocking unused-variable warnings are confined to `tests/ui/landing-source.test.ts`.
- TypeScript: exit 0.
- Next production build: exit 0; 10/10 static pages generated.

**Follow-up polish**

- P3: remove the three obsolete unused test helpers when the legacy sweep contracts are retired. This does not affect the product or visual result.

final result: passed
