# Inspiration-Led Global UI Design

## Objective

Rebuild the Solvo landing page to faithfully reflect the supplied lamp reference while carrying the same restrained design language through the entire web application. Preserve existing routes, content, and functional controls.

## Source of Truth

The supplied `ui.jpg` is the visual source of truth for composition and hierarchy. The existing `DESIGN.md` remains authoritative for Solvo's product language, monochrome palette, sharp geometry, execution states, accessibility, and content rules. Where they conflict, the user's reference overrides the current oversized hero headline, framed-card layout, and black outer gutters.

## Global Visual System

- Use one continuous charcoal field across the full viewport. A subtle vignette may deepen the edges, but there must be no separate black background framing a central page.
- Retain the monochrome Solvo palette: off-white text, restrained grey hierarchy, faint hairlines, and a single white lamp glow.
- Use the existing local-first font stack: `"Helvetica Neue", Arial, Helvetica, sans-serif`, with Arial used when Helvetica Neue is unavailable. No font download or new typography dependency is required. Display copy must remain controlled and must never dominate the lamp composition.
- Retain sharp geometry: zero-to-four-pixel radii, hairline separators, transparent buttons, and no pills, glassmorphism, saturated accents, or decorative gradients.
- Use the lamp as the only hero illustration. Its bulb must sit directly beneath the shade, with a compact glow and a thin cable extending toward the top edge.
- Apply the shared background, typography, navigation, buttons, panels, section rhythm, and footer to every route through common layout components and tokens.

## Landing Page

### Above the Fold

The first viewport recreates the reference composition:

1. A small single-letter `S` Solvo mark at the upper left, linking to `/`.
2. A sparse text navigation at the upper right: `PRODUCT` links to `/community`, `HOW IT WORKS` links to `/how-it-works`, and `TELEGRAM` uses the existing configured Telegram destination.
3. A compact pendant lamp centered above the hero focal point.
4. A modest, low-contrast ghosted `SOLVO` word behind the focal point.
5. A small visible `SOLVO` wordmark followed by the exact supporting line `Telegram payment coordination with KeeperHub-backed proof.`
6. Minimal left and right arrows at the horizontal midpoint. They are visual composition marks, not buttons, and are hidden from assistive technology.
7. A continuous three-cell execution strip anchored visually to the bottom of the first viewport with this exact content:
   - `01. CHECK` - `Validate addresses, amounts and limits.`
   - `02. EXECUTE` - `Simulate and submit through KeeperHub.`
   - `03. PROVE` - `Return the hash and audit record.`

The current oversized "From instruction to execution" headline is deleted entirely. The stacked Telegram CTA, secondary CTA, and execution-path link row are removed from the first viewport. The primary Telegram action moves into the content immediately below the execution strip.

### Existing Sections

Retain the current product story, execution line, agent visibility, community and individual use cases, receipt, and final CTA. The duplicate standalone execution strip is removed because the strip now closes the hero. Apply these explicit changes:

- use a maximum readable text width of 640 pixels and a maximum proof-component width of 760 pixels;
- use 96-128 pixels between major desktop sections and 64-80 pixels on mobile;
- place descriptive copy and its related proof component in a two-column layout where the viewport is at least 900 pixels, stacking below that width;
- group the two use cases into one hairline-divided row rather than separate cards;
- keep the execution receipt fields in their current semantic order, with amount, destination, status, and proof visually emphasized;
- use restrained outline actions only for real navigation or conversion actions.

The section sequence is:

1. Compact product introduction and Telegram action.
2. Execution line and product-state explanation.
3. Agent checks and decision visibility.
4. Community and individual use cases.
5. Execution receipt as the primary proof moment.
6. Final Telegram CTA and shared footer.

## Application Routes

All existing routes remain available. `PageShell`, `SiteNav`, `Footer`, buttons, labels, data rows, policy rows, previews, receipts, and state panels receive the shared visual refactor.

- Route headers use compact editorial titles rather than oversized marketing headlines.
- Long content pages use a readable centered content column on the continuous full-width field, without a floating central card or black gutters.
- Related facts are grouped into continuous bordered rows instead of many separate cards.
- Functional and data-heavy screens keep amounts, addresses, approval requirements, statuses, errors, and proof legible above decorative concerns.
- Existing links, menus, claim flows, sandbox controls, judge-demo controls, receipt links, and Telegram behavior remain functional.

## Navigation and Footer

- Desktop navigation uses the small mark on the left and the exact three restrained links `PRODUCT`, `HOW IT WORKS`, and `TELEGRAM` on the right.
- Mobile navigation uses an accessible menu button and a full-width menu surface that visually belongs to the same charcoal field.
- Active, hover, and focus states remain visible without introducing accent colors.
- The footer becomes a quiet hairline-separated closing area with the Solvo wordmark, core proof statement, and route links.

## Responsive Behavior

- Desktop compositions fill the viewport width without black side gutters. Content may sit inside a centered max-width wrapper, but it must not create a second contrasting page plane.
- The landing hero keeps the lamp, wordmark, and execution strip within the first viewport at common laptop and desktop sizes.
- On tablets and phones, the lamp and wordmark scale down proportionally, navigation collapses, and the execution strip stacks into three rows.
- Long addresses and hashes wrap or truncate safely while remaining selectable and copyable.
- Touch targets remain at least 44 pixels even when labels are visually small.

## Motion and Accessibility

- Initial motion is limited to subtle opacity staging for the lamp, wordmark, and navigation.
- Lamp glow may breathe very gently; all motion is disabled under `prefers-reduced-motion`.
- Menu controls, CTAs, and copy actions have visible focus states and descriptive labels. Decorative hero arrows are excluded from the accessibility tree.
- Product states always include written labels and never rely on lightness alone.
- Body and important financial data retain sufficient contrast against the charcoal field.

## Implementation Boundaries

- Do not change the application's business logic, backend assumptions, route structure, or product terminology except to remove redundant landing-page copy.
- Do not introduce generated imagery, new illustration systems, icon packs, or dependencies unless required to preserve an existing interaction.
- Reuse and refit existing components before creating new ones.
- Keep unrelated user changes intact.

## Verification

- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Visually compare the landing page against `ui.jpg` at 800x600, the current recreation at 1920x1080, and the responsive result at 390x844.
- Confirm the first viewport has no black outer frame, oversized headline, detached bulb, or misplaced CTAs.
- Exercise desktop and mobile navigation, Telegram actions, and representative interactive routes.
- Record each comparison in `design-qa.md` with the viewport, observed difference, severity, and resolution. Severity is: P0 for unusable or missing content, P1 for a major structural mismatch, P2 for a clearly visible spacing/type/color mismatch, and P3 for minor polish. P0, P1, and P2 findings must be resolved before handoff.
