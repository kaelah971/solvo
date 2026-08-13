# Solvo main-word typing correction

## Required hierarchy

- The oversized, bold, widely tracked main `SOLVO` is the animated typing word.
- On desktop, the main word must be at least as large as the approved pre-typing hero and remain the dominant typography.
- The smaller `SOLVO` remains fully written, static, near-white, generously spaced, and centered directly below the main word throughout every animation phase.
- Both words share one horizontal center. The small word must never follow the large cursor or shift sideways.

## Motion

- The large main word repeats: type each of five letters in about 0.7s total, hold for 1.4s, erase in about 0.5s, pause empty for about 0.7s, restart.
- A thin blinking cursor follows the visible edge of the large main word and sits directly after the large final `O` during the full hold.
- Reserve the full large-word footprint so the lockup, static small word, lamp, descriptor, and strip never move.
- Use identical explicit character boundaries for the large reveal and cursor.
- The small sub-word is not animated.

## Lamp regression constraint

- Preserve the approved lamp image `/images/solvo-pendant-lamp-v3.png`, its intrinsic dimensions, rendered responsive sizes, horizontal center, and hero position.
- Do not replace, resize, crop, or reposition the lamp as part of this correction.

## Accessibility

- Keep the stable screen-reader `h1` of `Solvo`.
- Mark the animated large word and cursor decorative.
- Reduced motion displays the complete large SOLVO without a cursor and retains the complete static small SOLVO below it.

## Verification

- Write failing contracts before changing product source.
- Verify exact 800x600, 1920x1080, 390x844, and 844x390 browser views.
- Compare against `ui.jpg`, `Screenshot (1421).png`, and `Screenshot (1422).png`.
- Confirm the lamp has no source/geometry regression, the main desktop SOLVO is dominant, the small word stays centered, the loop repeats, and no phase changes layout.

