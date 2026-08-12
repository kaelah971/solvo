# Solvo Hero Lamp Refinement

## Goal

Bring the landing hero materially closer to `ui.jpg` while preserving the SOLVO brand and the existing navigation, execution strip, and lower landing sections.

## Approved composition

- The central word remains `SOLVO` as editable HTML text.
- The five letters use a geometric sans, medium-to-bold weight, muted charcoal fill, and conspicuously wide tracking so they read as separate forms like the reference.
- The word sits behind the bulb and inside the visible pool of light, centered at the same visual height as the reference.
- The small visible `SOLVO` wordmark and supporting sentence remain beneath the ghost word.
- The top-left `S` becomes larger and stronger while retaining its home-link semantics and minimum touch target.

## Lamp asset

Replace the current line-drawn SVG in the landing hero with one realistic raster pendant-lamp assembly generated specifically for the page. The asset includes a ceiling mount, a long vertical cable, the reference-like curved loop/jog, a dark compact dome shade, a white bulb touching the shade, a restrained bloom, and a soft downward cone that visibly illuminates the central letters. The asset stays monochrome and uses the existing charcoal palette. It contains no text.

The generated asset is decorative; the existing accessible hero heading continues to name Solvo. The page must not expose duplicated lamp descriptions to assistive technology.

## Responsive behavior

- At 800×600 and 1920×1080, the lamp cable descends from the hero's upper region and the shade remains centered above the word.
- The light cone overlaps the central word without reducing legibility.
- At 390×844, the assembly scales down without cropping the shade, bulb, or word.
- At 844×390, the existing short-height treatment remains usable and the execution strip stays reachable.

## Scope

Change only the landing hero asset/composition and the shared top-left navigation mark. Do not change navigation labels, routes, execution-strip copy, lower landing content, application behavior, or backend code.

## Verification

Add focused UI source contracts for the new asset, separated ghost lettering, and enlarged brand mark. Run the UI tests and lint. Run type checking and the Next build, reporting any unrelated pre-existing failures separately. Capture and compare the rendered landing page against `ui.jpg` at 800×600 and against the supplied current screenshot at 1920×1080, plus 390×844 and 844×390 responsive checks. Update `design-qa.md`; completion requires no unresolved P0, P1, or P2 visual differences in this scope.
