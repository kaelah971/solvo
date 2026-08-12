# Solvo Charcoal, Wordmark, and Living-Light Refinement

## Goal

Bring the landing hero closer to `ui.jpg` by lifting the black substrate to a layered charcoal field, correcting the small visible `SOLVO`, and adding a restrained continuous animation to the large ghost word.

## Visual target

- The landing page uses a continuous charcoal-gray atmosphere rather than a flat black field. The central hero is approximately `#2b2e32` at its brightest region, falling toward `#17191c` at the viewport edges. There are no black side gutters and no separate black rectangle behind the page.
- Lower landing sections inherit the same charcoal family so the application remains visually continuous.
- The large `SOLVO` keeps its separated geometric letterforms and reference-led position, grows approximately 8% from the current implementation, and gains a small optical-weight increase without becoming heavier than the lamp. Its resting color remains muted charcoal rather than white.
- The small visible `SOLVO` is no longer tiny, compressed, or bright white. It uses approximately 13px type, medium weight, `0.48em` tracking, and muted gray near `#9a9ca0`, matching the reference's airy secondary wordmark. Its width and vertical gap scale with the lamp and large word so the three elements read as one proportional lockup.

## Continuous motion

Use a living-light animation driven by the pendant lamp:

- The lamp retains its slow four-second breathing cycle.
- A soft vertical illumination band crosses the large `SOLVO` from left to right every eight seconds.
- The band brightens letters only into muted medium gray; it never turns the entire word white and never outshines the bulb.
- The letters do not translate, scale, rotate, or change tracking.
- The animation uses compositor-friendly opacity and transform on one clipped pseudo-element or overlay. It does not animate layout, large-area blur, or inherited CSS variables.
- The sweep pauses when the page is not visible where the existing architecture permits this without adding a client-side animation dependency.
- `prefers-reduced-motion: reduce` removes the sweep and lamp breathing, leaving the final resting appearance intact.

## Responsive behavior

- At 800×600 and 1920×1080, the highlight remains confined to the large word and aligned with the lamp rays.
- At 390×844 and 844×390, the sweep remains subtle and never covers the foreground wordmark, supporting sentence, arrows, navigation, or execution strip.
- The corrected small wordmark remains legible without wrapping.

## Scope

Change landing/global color tokens only where necessary to remove the black appearance across the existing application. Change `Wordmark`, the large ghost-word presentation, and their motion styling. Preserve the lamp asset, navigation labels/routes, hero copy, execution strip, lower content, application behavior, and backend.

## Verification

- Add source contracts for the corrected small-wordmark size/tracking/color, lifted charcoal substrate, continuous eight-second sweep, and reduced-motion suppression.
- Run the complete UI source suite, lint, type check, and Next build.
- Browser-capture the final landing page at 800×600, 1920×1080, 390×844, and 844×390, compare the 800×600 state with `ui.jpg`, inspect animation frames at rest and mid-sweep, and update `design-qa.md`.
- Completion requires no unresolved P0, P1, or P2 issue and `final result: passed`.
