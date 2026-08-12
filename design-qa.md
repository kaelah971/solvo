# Solvo redesign — design QA

Date: 2026-08-11  
QA scope: reference-led landing page, shared navigation, representative content/data states, responsive behavior, interaction, and accessibility.  
Browser surface: Codex in-app Browser only (`iab`).  
Preview: `http://127.0.0.1:3000` (hidden Next.js dev process PID 19880; HTTP 200 confirmed after the final build attempt).

## Source and comparison evidence

- Source truth: `C:\Users\emman\Downloads\Telegram Desktop\ui.jpg` — 800×600 pixels.
- Prior recreation: `C:\Users\emman\OneDrive\Pictures\Screenshots\Screenshot (1380).png` — 1920×1080 pixels, including browser/OS chrome.
- Full source/current comparison: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\comparison-source-vs-home-800x600.png` — 1600×600.
- Focused source/current comparison: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\comparison-source-vs-home-800x600-focused.png` — 1280×500.
- Prior/current wide comparison: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\comparison-prior-vs-home-1920x1080.png` — 3840×1080.
- Normalized implementation inputs: `home-800x600-normalized.png` — 800×600; `home-1920x1080-normalized.png` — 1920×1080, in the same evidence directory.

The 800×600 implementation capture was 785×589 physical pixels for an 800×600 CSS viewport and was bicubically normalized to 800×600 solely for same-canvas comparison. The 1920×1080 capture was 1905×977 physical pixels for a 1920×1080 CSS viewport; it was scaled uniformly to 1920 pixels wide and centered on a 1920×1080 `#141414` canvas. This preserves its aspect ratio while accounting for the in-app Browser capture surface. The Browser reported density near 1.25 at 800 CSS pixels and near 1 at 1920 CSS pixels.

Combined-input judgment: the final 800 composition retains the source's quiet dark field, small top navigation, single lamp focal point, restrained centered wordmark/copy, lateral arrows, hairline divisions, and continuous three-step strip. At 1920, the prior recreation's oversized headline, black side gutters, and vertically stacked CTA treatment are absent. The wider result stays sparse and centered without introducing a competing first-viewport hierarchy. No actionable P0–P2 fidelity issue remains.

### Mandatory combined-comparison passes

- **Typography — passed:** in the combined source/current 800×600 full and focused inputs, the implementation preserves the reference's restrained uppercase navigation and step labels, quiet oversized background wordmark, and small centered foreground wordmark/copy. The 1920 combined input confirms the prior recreation's dominant display headline has been removed. The remaining type-scale differences support legibility without creating a competing hierarchy, so no typography P0–P2 remains.
- **Spacing and layout — passed:** the combined 800×600 inputs show the same top-navigation / central lamp-and-wordmark / lower three-step progression, with generous negative space and continuous hairline grouping. The combined 1920×1080 input confirms the former side gutters and misplaced vertical CTA stack are gone; the composition now scales as one centered field. No overlap, clipping, broken alignment, or material spacing drift remains at P0–P2.
- **Colors and tokens — passed:** side-by-side inspection shows the implementation retains the source's near-black substrate, low-contrast charcoal structure, muted gray copy, and concentrated off-white lamp highlight without introducing bright card surfaces or unrelated accent colors. The post-fix essential-copy token reaches 5.48:1 while decorative faint marks remain appropriately subordinate. No color/token P0–P2 remains.
- **Image and asset fidelity — passed:** the combined inputs preserve the source's single suspended-lamp silhouette, cable, halo, and illuminated wordmark treatment as the only focal asset. The implementation does not substitute an unrelated illustration, placeholder, or competing image, and the wide comparison shows the lamp stays centered and proportionate. No image/asset P0–P2 remains.
- **Copy and content — passed:** the combined 800×600 input keeps the concise centered promise and three-step narrative in the same semantic positions as the source, adapted truthfully to Solvo (`Check`, `Execute`, `Prove`) rather than adding unsupported claims. The 1920 comparison confirms the verbose prior headline/CTA stack no longer overwhelms the first viewport. No copy/content P0–P2 remains.

## Implementation screenshots

| Route/state | CSS viewport | Capture pixels | Result |
| --- | ---: | ---: | --- |
| `/`, closed menu | 800×600 | 785×589 | One `main`; no overflow; source comparison passed. `home-800x600.png` |
| `/`, closed menu | 1920×1080 | 1905×977 | One `main`; no overflow; prior-defect comparison passed. `home-1920x1080.png` |
| `/`, closed menu | 390×844 | 375×811 | Mobile navigation; no overlap or horizontal clipping; strip reachable. `home-390x844.png` |
| `/`, closed menu | 844×390 | 829×383 | Short-landscape layout; no horizontal overflow; strip reachable. `home-844x390.png` |
| `/`, menu open | 390×844 | 375×811 | Opaque mobile panel, named links, close control. `home-mobile-menu-open.png` |
| `/`, visible keyboard focus | 390×844 | 375×811 | Visible off-white focus outline evidence. `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\home-keyboard-focus.png` |
| `/`, 200%-reflow equivalent | 640×400 | 625×391 | Equivalent to halving a 1280×800 CSS viewport; mobile reflow, one `main`, no horizontal overflow. `home-200pct-equivalent-640x400.png` |
| `/community` | 1280×800 | 1265×791 | Correct identity/content, one `main`, no overflow. `community-1280x800.png` |
| `/community` | 390×844 | 375×811 | No overlap or horizontal clipping. `community-390x844.png` |
| `/sandbox` before contrast fix | 1280×800 | 1265×791 | Honest unavailable state; notice contrast finding recorded below. `sandbox-1280x800.png` |
| `/sandbox` after contrast fix | 1280×800 | 1265×791 | Essential notices at 5.48:1. `sandbox-1280x800-postfix.png` |
| `/sandbox` before contrast fix | 390×844 | 375×811 | Same initial contrast finding. `sandbox-390x844.png` |
| `/sandbox` after contrast fix | 390×844 | 375×811 | Reflow and contrast passed. `sandbox-390x844-postfix.png` |
| `/receipt/qa-missing-record` | 1280×800 | 1265×791 | Honest not-found state; no fabricated execution success. `receipt-1280x800.png` |

All files above are under `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\`. Each saved file was converted and verified as a true PNG.

## Browser and interaction results

- Identity/DOM: `/` titled `From instruction to execution`; internal pages use their route titles with the Solvo template. Every checked state had meaningful content and exactly one `main` landmark.
- Runtime: no application/runtime/build-error text, visible framework error overlay, or unexplained console error/warning appeared during the captured flows. The small `N` control is Next.js development toolbar chrome, not product UI.
- Responsive/overflow: `scrollWidth <= clientWidth` on the tested home, community, sandbox, receipt, mobile, landscape, and 640×400 reflow-equivalent states.
- Desktop navigation: `Product` reached `/community`; `How it works` reached `/how-it-works`; URL, title, and route DOM updated correctly.
- Landing links: `Community treasury` reached `/community`; `Personal payments` reached `/individuals`.
- Mobile navigation: native `Open menu` button opens and closes the menu, reports `aria-expanded`, selects `Community`, closes on Escape, and returns focus to the menu button.
- Telegram CTA: the current unconfigured environment renders a non-link state with the accessible title `Telegram bot URL is not configured` and a written configuration note. A configured environment was not available, so that conditional branch was not exercised.
- Sandbox: textarea is disabled and `aria-disabled`; the 44px submit presentation is a non-actionable `span` with `aria-disabled`, title `The sandbox backend is not connected`, and written `SIMULATION UNAVAILABLE` / `NO FUNDS WILL MOVE` status.
- Claim/receipt: `/claim/qa-unavailable` rendered a disabled, named claim input and unavailable status. `/receipt/qa-missing-record` rendered an honest not-found record state.
- Keyboard/focus: the native links/buttons have visible solid off-white outlines with offset. Click, Escape, and focus return were browser-verified. The in-app Browser's DOM-CUA/locator layer did not synthesize native Tab/Enter/Space default actions (a root-thread reproduction confirmed the same limitation); semantics remain native `<a>`/`<button>`, so this is recorded as tooling coverage risk rather than a product defect.
- Zoom/reflow: browser shortcut synthesis did not change zoom. The equivalent halved CSS viewport (640×400 from a 1280×800 baseline) reflowed to the mobile layout with no horizontal overflow and preserved readable content and access to the strip.
- Reduced motion: CSSOM contains `@media (prefers-reduced-motion: reduce)` rules that suppress `.hero-enter`, `.hero-enter-delayed`, and `.lamp-breathe`, reduce other animation/transition duration to 0.01ms, and constrain iteration count to one. The Browser surface did not expose media emulation.
- Touch targets: rendered interactive home/navigation links and buttons measured at least 44px in the tested mobile state. Disabled claim/sandbox presentations are not actionable touch targets.
- Contrast: essential small copy after the fix is `rgb(140, 140, 140)` on `rgb(20, 20, 20)`, measured at 5.48:1. Remaining faint 3.61:1 elements are decorative/hidden arrows, rules, or numbering rather than essential instructions/status.

## QA iterations

### P1 — mobile Escape/focus behavior

- Initial evidence: the mobile menu opened and clicked closed, but the component had no Escape listener or explicit focus restoration.
- Narrow fix: `src/components/SiteNav.tsx` now listens for Escape only while open, closes the menu, and focuses the native menu button through a ref.
- Regression coverage: `mobile navigation closes on Escape and returns focus` was added to `tests/ui/shared-shell-source.test.ts` and passed.
- Post-fix Browser evidence: at 390×844, Escape changed `aria-expanded` to `false`, removed the menu, and left the `Open menu` button as the active element.

### P2 — essential small-text contrast

- Initial evidence: seven essential page-level notices used `text-faint` (`#6e6e6e`) on `#141414`, a measured 3.61:1, below the WCAG AA 4.5:1 threshold for small text.
- Narrow fix: only the affected notice paragraphs in claim, community, how-it-works, judge, and sandbox pages were changed to the existing `text-muted` token. Decorative faint elements were left unchanged.
- Regression coverage: `essential page-level notices do not use the faint text token` was added to `tests/ui/shared-primitives-source.test.ts` and passed.
- Post-fix Browser evidence: all seven phrases resolved to `rgb(140, 140, 140)` on `rgb(20, 20, 20)`, 5.48:1. The sandbox desktop/mobile states were recaptured at the same viewports.

No remaining P0, P1, or P2 design/accessibility finding was observed.

## Automated verification

- `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts tests/ui/shared-primitives-source.test.ts`: **17/17 passed** (the brief's original 15 plus the two new regression tests).
- `cmd /c npm run lint`: **passed**, exit 0.
- `cmd /c npm test`: **93/96 passed, 3 loader failures**. Node v24.15.0 strip-only mode rejects TypeScript parameter properties in concurrent server/execution files. A coordinator rerun with `--experimental-transform-types` progressed beyond parsing and exposed four unrelated execution/state assertions. This is outside the authorized planned-UI scope and was not edited here.
- `cmd /c npx tsc --noEmit`: **failed on external shared-worktree server/test changes**. With the stale incremental cache bypassed, remaining errors are in `src/server/db/postgres-repository.ts` and `tests/execution/state-machine.test.ts`; the UI files/tests are clean.
- `cmd /c npm run build`: application compilation **passed**, then the TypeScript phase failed on the same external repository/test errors. No UI compile error was reported.
- Post-attempt runtime check: exact host returned HTTP 200 with the expected home title; PID 19880 remained the `127.0.0.1:3000` listener.

These automated failures are a real full-project integration risk, but they arrived through concurrent, non-UI server/test/config changes after the UI baseline and are outside this task's authorized edit scope. Per coordinator ruling they are recorded as concerns rather than converted into visual-design blockers.

## Remaining P3/tooling concerns

- The Next.js development toolbar appears in local screenshots; it is dev-only chrome.
- Configured Telegram and connected backend success paths were unavailable, so only their honest unconfigured/unavailable presentations were verified.
- Native Tab/Enter/Space and browser-zoom default-action synthesis were unavailable in the in-app Browser automation layer; native semantics, visible focus, Escape/focus return, and equivalent viewport reflow were verified instead.
- The final cleanup/reset call was denied by the Browser security auto-review after evidence collection; the already-verified preview remains open and the server remains running.
- The concurrent server/test/type failures above should be resolved by the owning task before claiming the repository-wide suite is green.

Historical baseline result: passed

## Hero lamp refinement — provisional visual QA

Date: 2026-08-11  
Scope: Task 4 verification of the generated pendant lamp, illuminated `SOLVO`, enlarged home mark, and responsive hero only.  
Browser surface: Codex in-app Browser (`iab`).  
Implementation: `http://127.0.0.1:3000/`, closed mobile menu unless a state is named.

### Source truth and normalized comparison evidence

- Reference: `C:\Users\emman\Downloads\Telegram Desktop\ui.jpg` — 800×600 pixels.
- Prior implementation: `C:\Users\emman\OneDrive\Pictures\Screenshots\Screenshot (1397).png` — 1920×1080 pixels including browser and OS chrome.
- Browser-rendered implementation at an 800×600 CSS viewport: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\home-800x600.png` — 785×589 capture pixels, DPR 1.25, normalized bicubically to `home-800x600-normalized.png` at 800×600.
- Browser-rendered implementation at a 1920×1080 CSS viewport: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\home-1920x1080.png` — 1905×977 capture pixels, DPR approximately 1, scaled uniformly to 1920 pixels wide and centered on a 1920×1080 `#141414` canvas as `home-1920x1080-normalized.png`.
- Same-size full comparison: `comparison-source-vs-home-800x600.png` — 1600×600; source left, implementation right.
- Same-size prior/current comparison: `comparison-prior-vs-home-1920x1080.png` — 3840×1080; prior screenshot left, implementation right. The left side includes browser/OS chrome while the right side is a normalized page capture, so chrome is excluded from fidelity findings.
- Focused lamp/cable comparison: `comparison-source-vs-home-cable-shade-focused.png` — 800×510.
- Focused light/word comparison: `comparison-source-vs-home-light-word-focused.png` — 1240×326.
- Focused mark comparison: `comparison-source-vs-home-mark-focused.png` — 680×340.

All implementation and comparison files in this section are under `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\`.

### Findings

- **[P2] The pendant cable path and fixture proportions still do not match the explicitly requested reference geometry.**  
  Location: landing hero, `.hero-lamp` / `public/images/solvo-pendant-lamp.png`.  
  Evidence: in `comparison-source-vs-home-cable-shade-focused.png`, the reference cable enters from the very top, travels through a broad U-shaped adjustable loop almost as wide as the shade, and terminates in a larger low dome. The implementation begins below the 84px navigation region, uses a very narrow one-sided jog, and has a smaller, softer shade. The raster lamp is now realistic and includes a cable, bulb, and glow, but the named “drop down exactly like the inspo” geometry remains visibly different.  
  Impact: the cable silhouette is one of the user's specifically requested corrections and the hero's only illustration; the mismatch is noticeable at first glance.  
  Fix: regenerate or recrop the no-text raster so the cable has the reference's broad U loop and short left descent before the long shade drop; enlarge the dome roughly 15–20%; then place the mount at the hero/viewport top rather than below the navigation. Recapture at 800×600 and 1920×1080.

- **[P2] The ghost word is still materially larger, wider, and lower than the same-size reference.**  
  Location: `GhostWordmark` and `.hero-word-stack`.  
  Evidence: in `comparison-source-vs-home-800x600.png` and `comparison-source-vs-home-light-word-focused.png`, the reference ghost word occupies roughly a 240px span with a restrained approximately 50px letter scale. The implementation occupies about 348px at 72px with 20.16px computed tracking and begins around y=294. The letters are now clearly separated, semibold, and correctly muted, but their overall footprint still dominates more than the reference and sits lower beneath the lamp.  
  Impact: scale and placement were explicitly requested, and the larger footprint weakens the quiet, compact reference composition.  
  Fix: reduce the 800px word size toward 52–56px, retain at least `0.24em` tracking, cap the wide-screen size near 96–104px, and move the desktop word stack upward approximately 35–45px. Recheck that the generated rays still overlap the middle letters.

No P0 or P1 finding was observed.

### Required fidelity surfaces

- **Typography:** blocked only by the P2 ghost-word scale/tracking/position finding. Weight, muted token, foreground wordmark, navigation hierarchy, and copy remain coherent.
- **Spacing/layout:** responsive structure is stable with no horizontal overflow at 800×600, 1920×1080, 390×844, or 844×390. The execution strip remains reachable. The cable origin and word position remain blocked as described above.
- **Colors/tokens:** passed. The near-black field, muted ghost text, gray copy, and single white bulb remain within the monochrome design system.
- **Image quality/asset fidelity:** the PNG is a real decorative raster (926×1698 source), loads successfully, has no text, and produces a credible bulb/bloom/cone. Blocked only by the P2 cable/fixture geometry mismatch; no transparency halo or unrelated asset was observed.
- **Copy/content:** passed. `SOLVO`, supporting sentence, navigation labels, execution strip, and lower content remain unchanged.

### Responsive, interaction, and runtime evidence

- `home-390x844.png` — 390×844 CSS viewport, 375×811 capture. Mobile menu is closed; no horizontal overflow; lamp, word, copy, and all three execution steps remain reachable.
- `home-844x390.png` — 844×390 CSS viewport, 829×383 capture. Short-height treatment stays compact with no horizontal overflow; the visible lamp artwork does not cover the strip copy.
- `home-390x844-keyboard-focus.png` — after opening the native mobile menu and pressing Escape, `aria-expanded` returned to `false`, the menu detached, focus returned to `Open menu`, and the computed focus outline was solid off-white with offset.
- The home mark is a 44×44 link with `aria-label="Solvo home"`; computed type is 16px/600 and is visibly stronger than the prior 11px mark.
- The lamp image completed with a nonzero natural size at every viewport. No visible framework/runtime/build-error text, broken image, application console warning, or application console error was observed. The present `nextjs-portal` is the development toolbar, not an error overlay.
- Reduced-motion emulation was not exposed by the selected Browser. Source and browser CSSOM both contain `@media (prefers-reduced-motion: reduce)` rules that remove `.hero-enter`, `.hero-enter-delayed`, and `.lamp-breathe` animation and constrain all remaining animation/transition duration.

### Automated gates

- `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts tests/ui/shared-primitives-source.test.ts`: **20/20 passed**.
- `npm run lint`: **exit 0**, with six existing warnings in Telegram server/test files and no errors.
- `npx tsc --noEmit`: **failed outside this visual scope** at `scripts/tmp-debug-member.ts:26` (`void` passed where a string/number/null/undefined is required).
- `npm run build`: application compilation **passed in 4.1s**, then TypeScript failed at the same concurrent debug script (reported at line 27 during this run). No hero/UI compilation error was reported.

### Implementation checklist

1. Replace the tight cable jog with the source's broad U-loop and enlarge the shade while keeping the real raster, bulb, and light cone.
2. Move the fixture origin to the page/hero top and align the shade above the word at both desktop targets.
3. Reduce and lift the ghost word while retaining separated letters, semibold weight, muted color, and visible light overlap.
4. Recapture and rerun the same full and focused comparisons; only then change the refinement result to passed.

Historical refinement result before fixes: blocked

## Hero lamp refinement — final visual QA

Date: 2026-08-11  
Scope: final verification of the pendant lamp, illuminated and separated `SOLVO`, enlarged home mark, and responsive hero.

### Final browser evidence

- Primary browser-rendered implementation: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\home-800x600-final.png` — captured from an 800×600 CSS viewport at 785×589 physical pixels and normalized to 800×600 for comparison.
- Same-size final comparison: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\comparison-source-vs-home-800x600-final.png` — source left, final implementation right.
- Focused final lamp/word comparison: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\comparison-source-vs-home-lamp-word-final.png`.
- Mobile final capture: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\hero-refinement\home-390x844-final.png`.
- Short-landscape behavior was already browser-verified at 844×390 before the cache-busting filename change; the final asset keeps identical intrinsic dimensions and layout ownership. The subsequent in-app Browser surface could not produce another trustworthy wide screenshot after its preview session resized, so this remains a P3 evidence limitation rather than an inferred pass from a malformed capture.
- State: dark theme, home route, closed navigation menu. Browser console: no warning or error. The final asset loaded from `/images/solvo-pendant-lamp-v3.png` with a nonzero natural size.

### Comparison history and resolved findings

- **Earlier P2 — tight cable jog and undersized shade:** resolved. The final generated raster uses a visible bottom U-return with a separate left descent, a wider/deeper dome, a touching bulb, and a soft downward beam. The asset-level 270px composite measured the loop and shade before integration, then a cache-busting filename forced the browser to load the corrected pixels.
- **Earlier P2 — oversized, low ghost word:** resolved. At the 800×600 CSS viewport the browser measured the ghost word at approximately 241×45 pixels, top y=250, with `0.28em` tracking, semibold weight, and the approved ghost token. The final comparison shows distinct, separated letters under the visible lamp rays.
- **Requested top-left mark:** passed. The home link remains a 44×44 accessible target with `aria-label="Solvo home"`; the visible `S` is 16px/600 and materially stronger than the prior 11px mark.

### Required fidelity surfaces

- **Typography:** passed. `SOLVO` remains editable text with separated letterforms, compact reference-led footprint, semibold geometric weight, muted charcoal color, and small foreground wordmark hierarchy.
- **Spacing and layout:** passed. The lamp, ghost word, foreground wordmark, sentence, arrows, and continuous execution strip retain the reference's quiet vertical sequence. Mobile content stacks without horizontal overflow and the strip remains reachable.
- **Colors and tokens:** passed. The near-black field, muted lettering, gray copy, dark shade, concentrated white bulb, and single-source glow remain within `DESIGN.md`.
- **Image quality and asset fidelity:** passed. The hero uses a real 1024×1536 RGBA raster with clean transparency, a realistic shade/bulb, looped cable, and light cone; no inline SVG or placeholder drawing remains.
- **Copy and content:** passed. Product text remains `SOLVO`; navigation, supporting sentence, execution-strip copy, routes, and lower landing sections are unchanged.

### Final automated verification

- `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts tests/ui/shared-primitives-source.test.ts`: **20/20 passed**.
- `npm run lint`: **passed**, exit 0.
- `npx tsc --noEmit`: **passed** for the completed UI snapshot; a later concurrent, out-of-scope Telegram edit now fails at `src/server/telegram/flows/approval-flow.ts(16,42)` because `PolicyDecision` is not exported.
- `npm run build`: **passed** for the completed UI snapshot, including TypeScript, static generation, and route finalization. The later unrelated Telegram type error is a current repository-wide integration risk.
- Exact preview host restarted at `127.0.0.1:3000` after the production build.

### Remaining P3 notes

- The reference ceiling mount begins at the absolute image edge; Solvo keeps the generated mount inside the navigation-safe hero region. The cable length, U-return, shade, bulb, and illuminated word relationship now carry the requested visual, so this does not remain a blocking mismatch.
- The small circular `N` visible in development captures is Next.js development toolbar chrome, not application UI.

No actionable P0, P1, or P2 visual issue was observed in the trustworthy final 800×600 and mobile evidence. The required post-v3 1920×1080 browser capture could not be obtained because the in-app Browser produced a malformed partial frame, so the full evidence gate remains incomplete.

final result: blocked

## Charcoal wordmark and living-light refinement — final QA

Date: 2026-08-12  
Scope: approved charcoal substrate, proportional `SOLVO` lockup, eight-second living-light sweep, required responsive states, and landing navigation behavior.  
Browser surface: Codex in-app Browser only (`iab`).  
Preview: exact built application at `http://127.0.0.1:3000` (HTTP 200 before Browser capture).

### Source truth and normalization

- Static reference: `C:\Users\emman\Downloads\Telegram Desktop\ui.jpg` — 800×600 pixels.
- Prior wide implementation reference: `C:\Users\emman\OneDrive\Pictures\Screenshots\Screenshot (1402).png` — 1920×1080 pixels including browser/OS chrome and a browser popup; those non-product regions were excluded from findings.
- Browser-rendered 800 resting state: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\charcoal-motion\home-800x600-rest.png` — 785×589 capture pixels for an 800×600 CSS viewport. It was bicubically normalized to 800×600 as `home-800x600-rest-normalized.png`.
- Browser-rendered 1920 state: `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\charcoal-motion\home-1920x1080.png` — 1905×977 capture pixels for a 1920×1080 CSS viewport. It was scaled uniformly to 1920×985 and centered vertically on a 1920×1080 `#17191c` canvas as `home-1920x1080-normalized.png`.
- Full normalized 800 comparison: `comparison-source-vs-home-800x600.png` — 1600×600, source left and resting implementation right.
- Full normalized wide comparison: `comparison-prior-vs-home-1920x1080.png` — 3840×1080, prior screenshot left and current implementation right.
- Focused lockup comparison: `comparison-source-vs-home-lockup-focused.png` — 1200×340.
- Focused rest/mid comparison: `comparison-rest-vs-mid-sweep-focused.png` — 760×150.
- Focused intermediate sweep sequence: `comparison-sweep-quarters-focused.png` — 1080×95, left-quarter / midpoint / right-quarter.

All implementation, normalized, combined, and focused evidence above is under `C:\Users\emman\.codex\visualizations\2026\08\11\019fee41-9800-7e52-80b5-108c273f7334\design-qa\charcoal-motion\`.

### Required viewport captures

| State | CSS viewport | Capture pixels | Browser result |
| --- | ---: | ---: | --- |
| `/`, resting word | 800×600 | 785×589 | Meaningful DOM, one `main`, no horizontal overflow, no runtime/console error. |
| `/`, active sweep | 1920×1080 | 1905×977 | Meaningful DOM, no horizontal overflow, lamp loaded, no runtime/console error. |
| `/`, menu closed | 390×844 | 375×811 | Mobile layout, wrapped supporting sentence, stacked strip, no horizontal overflow. |
| `/`, short landscape | 844×390 | 829×383 | Compact hero and three-column strip, no horizontal overflow or content collision. |
| `/`, menu open | 390×844 | 375×811 | All named menu links visible; `aria-expanded="true"`; 44×44 close control. |
| `/`, Escape focus return | 390×844 | 375×811 | Menu detached, `aria-expanded="false"`, focus returned to the 44×44 open control with a visible off-white outline. |

The first resized screenshot attempt at each of the two narrow viewports returned a malformed partial frame from the Browser surface. Both were immediately reacquired after the viewport settled; only the correctly dimensioned 375×811 and 829×383 files listed above are retained as evidence.

### Combined comparison and focused inspection

- **Background palette:** passed. Browser pixel inspection reaches `#2b2e33` at the hero center and falls to approximately `#18191d` at the capture edge, consistent with the approved `#2b2e32` → `#17191c` field. The substrate covers the full page width at every viewport; no black gutter or separate black landing rectangle appears.
- **Large word:** passed. At 800×600 the wrapper is 260.625×48.6 CSS pixels at document y=250, with 54px type, weight 650, 15.12px tracking, and computed `rgb(95, 98, 102)`. At 1920×1080 it is 542.063×101.088 CSS pixels with 112.32px type. It remains subordinate to the bulb and keeps the approved approximately-eight-percent increase.
- **Small word:** passed. Computed at 13px/500, 6.24px tracking (`0.48em`), and `rgb(154, 156, 160)` with a 16px gap at 800, 20px at 1920, and 12px on portrait mobile. The approved short-landscape override is 12px with a 4px gap. It never wraps.
- **Lamp-to-word proportions:** passed. Lamp boxes are 270×405 at 800, 360×540 at 1920, 250×375 at 390, and 168×252 at 844×390; the transparent raster canvas is not mistaken for visible overlap. The bulb remains the highest-luminance focal point.
- **Sweep confinement and quality:** passed. The focused rest/mid/quarter sequence shows a subtle glyph-clipped glint moving across the large word only. The midpoint brightens the `L` stem; quarter frames remain confined to existing glyph regions, with no readable displaced duplicate, spill onto the foreground mark/copy, or full-word white flash.
- **Image/copy fidelity:** passed. The real pendant-lamp raster loaded with nonzero natural dimensions. `SOLVO`, the supporting sentence, navigation labels, arrows, execution strip, and lower landing content remain intact.

### Motion and computed geometry

- `.ghost-wordmark-sweep` computed as `ghost-wordmark-sweep`, `8s`, `linear`, `infinite`; its active opacity was 0.72 and the wrapper clipped overflow.
- Timed 800×600 samples progressed left to right: translateX approximately `-294.94`, `-216.28`, `-138.85`, `-61.42`, `17.25`, `94.67`, `172.09`, and `248.28` CSS pixels at roughly one-second intervals, then wrapped back to the negative side after one full cycle.
- Rest evidence observed translateX `295.79px` with opacity `0.047`; midpoint evidence observed translateX `-0.19px` with opacity `0.72`.
- The base `SOLVO` rect remained exactly x=262.0875, y=243.6, width=260.625, height=60 across rest, midpoint, and the full sampled cycle (zero geometry delta).
- `.lamp-breathe` computed as a separate `4s ease-in-out infinite` animation.

### Runtime, interaction, accessibility, and reduced motion

- Every required viewport reported `scrollWidth === clientWidth`; no framework error text, missing lamp, console warning, or console error was observed.
- The mobile menu changed from `Open menu` / `aria-expanded="false"` to `Close menu` / `true`, exposed all links, closed on Escape, removed the menu node, and returned focus to the trigger.
- Focus computed as a solid `rgba(237, 237, 237, 0.7)` outline with approximately 0.8px rendered width and 2.4px rendered offset under the Browser's capture scaling.
- The selected in-app Browser exposed only `visibility` and `viewport` browser capabilities and no media-emulation control. Therefore reduced-motion behavior was not claimed from emulation. Browser CSSOM and source both contain `@media (prefers-reduced-motion: reduce)` disabling `.hero-enter`, `.hero-enter-delayed`, `.lamp-breathe`, and `.ghost-wordmark-sweep`; the active non-reduced environment computed the expected 4s/8s animations. The source contract for reduced motion passed.

### Findings and comparison history

No actionable P0, P1, or P2 finding remains.

- The earlier hero-refinement section was blocked only because a trustworthy post-fix 1920×1080 capture was missing. This pass supplied that Browser-rendered capture and the normalized prior/current comparison without changing source.
- The initial Task 3 pass required no visual fix. The moving-layer concern was explicitly checked at rest, midpoint, and both quarter positions; the visible result is a restrained glyph-clipped glint rather than a legible shifted duplicate.
- P3 evidence limitation: reduced-motion media emulation is unavailable in the selected Browser, so behavior is supported by CSSOM/source rules and the passing source contract, not an emulated screenshot.
- P3 implementation note: the CSS-only/server-rendered architecture does not explicitly pause the sweep when the page is hidden; the approved spec made that behavior conditional on the existing architecture avoiding a new client animation dependency.

### Automated gates

- `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts tests/ui/shared-primitives-source.test.ts`: **28 tests; 28 passed; 0 failed; 0 skipped/cancelled/todo**.
- `npm.cmd run lint`: **exit 0; 0 errors; 2 warnings**, both unused-variable warnings in `tests/ui/landing-source.test.ts` (`openingTags` and `ghostStyles`).
- `npx.cmd tsc --noEmit`: **exit 0; no diagnostics**.
- `npm.cmd run build`: **exit 0**; Next.js 16.3.0 compiled, TypeScript completed, and **10/10 static pages** generated. No concurrent out-of-scope failure occurred during these fresh gates.

final result: passed
