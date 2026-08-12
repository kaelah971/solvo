---
version: alpha
name: Solvo
description: "The Execution Receipt — a dark, quiet interface that makes every onchain payment state visible and provable."
colors:
  primary: "#EDEDED"
  background: "#141414"
  vignetteEdge: "#0A0A0A"
  surface: "#232323"
  surfaceTop: "rgba(255,255,255,0.03)"
  textPrimary: "#EDEDED"
  textSecondary: "#B8B8B8"
  textMuted: "#8C8C8C"
  textFaint: "#6E6E6E"
  textGhost: "rgba(237,237,237,0.05)"
  line: "rgba(255,255,255,0.08)"
  border: "rgba(255,255,255,0.06)"
  lampGlow: "#FFFFFF"
  lampShade: "#1A1A1A"
  lampCable: "#2E2E2E"
  stateSuccess: "#C8C8C8"
  stateWarning: "#999999"
  stateError: "#D6D6D6"
typography:
  display:
    fontFamily: "Neue Montreal, General Sans, Arial, sans-serif"
    fontSize: "7rem"
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: "-0.04em"
  wordmark:
    fontFamily: "Neue Montreal, General Sans, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.35em"
  nav:
    fontFamily: "General Sans, Neue Montreal, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.2em"
  body:
    fontFamily: "General Sans, Neue Montreal, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.05em"
  label:
    fontFamily: "General Sans, Neue Montreal, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.15em"
  data:
    fontFamily: "General Sans, Neue Montreal, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.08em"
rounded:
  none: 0px
  hairline: 1px
  button: 2px
  card: 4px
  maximum: 6px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
  page: 64px
components:
  wordmark:
    textColor: "{colors.textPrimary}"
    typography: "{typography.wordmark}"
  nav-link:
    textColor: "{colors.textMuted}"
    typography: "{typography.nav}"
    rounded: "{rounded.none}"
    padding: "8px 0"
  outline-action:
    backgroundColor: "transparent"
    textColor: "{colors.textPrimary}"
    typography: "{typography.nav}"
    rounded: "{rounded.button}"
    padding: "10px 24px"
  dark-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.textPrimary}"
    rounded: "{rounded.card}"
    padding: "28px"
  receipt-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.textPrimary}"
    rounded: "{rounded.card}"
    padding: "24px"
  status-label:
    textColor: "{colors.textSecondary}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
---

## Overview

**Solvo** is a Telegram-native conversational treasury execution product powered by KeeperHub. It turns a payment instruction into a validated, approved, simulated, executed and auditable USDC transaction.

The visual system preserves the supplied dark, single-light-source substrate:

- Void Black page field;
- charcoal floating card;
- oversized ghosted wordmark;
- one pendant lamp;
- sparse centered composition;
- sharp geometry;
- wide typographic tracking;
- almost no decorative interface chrome.

The meaning changes from an abstract lamp identity to **The Execution Receipt**. The lamp is the visible sign that value has reached a confirmed state. The interface stays quiet because financial state should be easy to inspect, not buried under visual noise.

### Brand territory

**The Execution Receipt**

> Solvo takes a request made in conversation and leaves behind proof that the payment happened.

### Core execution line

```text
REQUEST → CHECK → APPROVE → EXECUTE → PROVE
```

This line is not a decorative progress bar. Every stage corresponds to a real product state and must be backed by persisted execution data.

### Product rule

> Solvo should feel like a calm treasury operator showing its working—not a chatbot casually moving money.

## Colors

This is an intentionally monochrome system. There is no brand accent colour. Meaning comes from contrast, hierarchy, state labels and the single light source.

- **Void Black `#141414`** — primary page field and brand ground.
- **Vignette Edge `#0A0A0A`** — edge falloff around the central composition.
- **Charcoal `#232323`** — floating surface for the main product panel and cards.
- **Off-white `#EDEDED`** — primary text, confirmed information and the visible wordmark.
- **Secondary Grey `#B8B8B8`** — important supporting text and transaction values.
- **Muted Grey `#8C8C8C`** — navigation, labels and explanatory copy.
- **Faint Grey `#6E6E6E`** — low-priority numbering and secondary metadata.
- **Ghosted Wordmark `rgba(237,237,237,0.05)`** — oversized background texture only.
- **Divider `rgba(255,255,255,0.08)`** — hairlines and timeline separation.
- **Border `rgba(255,255,255,0.06)`** — restrained card edge.
- **Lamp Glow `#FFFFFF`** — the brightest point in the system.
- **Lamp Shade `#1A1A1A`** — dark illustrated fixture.
- **Lamp Cable `#2E2E2E`** — execution path and structural line art.

### Status colour policy

Solvo does not use saturated green, red, yellow or blue status colours in the core identity. Payment state is communicated through plain-language labels, position in the Execution Line, contrast and proof detail.

Use these grayscale state values only when a product surface requires additional differentiation:

- `#C8C8C8` — completed or verified;
- `#999999` — pending, review or simulation;
- `#D6D6D6` — failed, blocked or requires attention.

Never rely on colour alone. Every status must include a written label.

## Typography

### Neue Montreal / General Sans

The reference’s typography remains intact. Use **Neue Montreal** for display moments and the visible Solvo wordmark. Use **General Sans** for navigation, body copy, labels and transaction metadata.

If Neue Montreal is unavailable, use General Sans as the fallback. If both are unavailable, use a geometric sans with comparable proportions and wide tracking. Do not introduce a decorative serif or a futuristic display face.

### Type roles

- **Display:** large, quiet, tightly set uppercase or sentence-case headline. Use for the hero promise and major transaction state.
- **Wordmark:** small, centered, uppercase, `+0.35em` tracking.
- **Navigation:** 11px uppercase, `+0.2em` tracking.
- **Body:** 13px, `+0.05em` tracking, short paragraphs only.
- **Labels:** 11px uppercase, `+0.15em` tracking.
- **Data:** General Sans with tabular numerals where available; use for amounts, addresses, execution IDs, timestamps and state names.

### Voice in type

Type should feel held, deliberate and legible. Wide tracking creates poise; it must not reduce comprehension. Transaction amounts, destination addresses and failure reasons take priority over aesthetic tracking.

## Layout

### Page frame

- One centered primary card, maximum width approximately `1100px`.
- Outer page padding: `60px–80px` on desktop.
- Mobile page padding: `24px`.
- The card never touches the viewport edge on desktop.
- The page uses a large radial vignette centred on the card and slightly above it toward the lamp.
- The main composition is vertically centred with equal breathing room above and below.

### Navigation

- Single-letter Solvo mark or compact gate symbol at top-left.
- Text navigation at top-right: `PRODUCT`, `HOW IT WORKS`, `TELEGRAM`.
- No visible navigation bar background.
- Navigation sits directly on the charcoal surface.
- Use text links before boxed controls.

### Hero

The hero is a centred column:

1. Pendant lamp overlapping the top card edge;
2. oversized ghosted `SOLVO` wordmark behind the lamp;
3. small visible `SOLVO` wordmark;
4. primary promise;
5. short descriptor;
6. restrained request-to-proof navigation or anchor links.

Recommended hero copy:

```text
FROM INSTRUCTION
TO EXECUTION.
```

Supporting line:

```text
Telegram payment coordination with KeeperHub-backed proof.
```

### Execution strip

The lower feature strip is a single continuous row divided by hairlines:

```text
01. CHECK     Validate addresses, amounts and limits.
02. EXECUTE   Simulate and submit through KeeperHub.
03. PROVE     Return the hash and audit record.
```

It is not three separate cards. It is one sequence.

## Elevation & Depth

Depth is quiet and atmospheric rather than component-heavy.

- Page vignette: radial gradient from approximately `#1A1A1A` at the centre to `#080808` at the edges.
- Main card: subtle charcoal plane above the vignette.
- Card shadow: `0 40px 100px rgba(0,0,0,0.5)`.
- Surface top highlight: `1px inset 0 1px rgba(255,255,255,0.03)`.
- No floating glow except the lamp glow.
- No glassmorphism.
- No luminous borders.
- No gradient inside buttons, receipts or status panels.

The lamp glow is the single brightest point on the page. The completed state can be high-contrast in text, but must not visually outshine the lamp.

## Shapes

- Outer card radius: `4px`.
- Button radius: `2px`.
- Receipt panel radius: `4px`.
- Dividers: hairlines, never rounded boxes.
- Never exceed `6px` radius.
- No pills.
- No soft consumer-app cards.
- No excessive rounded-square icon grids.

Sharpness is part of the product meaning: this is controlled execution, not casual social software.

## Components

### Execution Receipt

The Execution Receipt is the principal proof component. It appears on the landing page, in the claim page, in the transaction detail view and in shareable demo material.

```text
SOLVO PAYMENT / 00421

REQUESTED BY / @alex
RECIPIENT    / 0x742d…B91A
AMOUNT       / 5.00 USDC
NETWORK      / BASE
STATUS       / COMPLETED
EXECUTION    / KH-8A12
TX HASH      / 0x91…E4C
AUDIT        / VIEW RECORD
```

Rules:

- Amount and status appear before low-level IDs.
- Destination is shown before approval.
- Simulation and real execution are visibly different in wording.
- A hash is never presented without a link or explanation of what it proves.
- Do not replace the receipt with a celebratory animation.

### Execution Line

```text
REQUESTED → VALIDATED → APPROVED → SUBMITTED → COMPLETED
```

Use one active state at a time. The current state must be readable without colour. Failure states use direct labels such as `VALIDATION FAILED`, `SIMULATION FAILED`, `EXECUTION FAILED` or `REVIEW REQUIRED`.

### Payment preview

```text
PAYMENT REQUEST

TO        / 0x742d…B91A
AMOUNT    / 5 USDC
NETWORK   / BASE
REQUESTED / @alex
APPROVAL  / REQUIRED

[ APPROVE ]  [ CANCEL ]
```

The preview is a dark card with a restrained border and ample whitespace. The approval action must not compete with the destination and amount.

### Batch summary

```text
PAYOUT / COMMUNITY REWARDS

RECIPIENTS / 42
TOTAL      / 850 USDC
VALID      / 41
DUPLICATES / 1
APPROVAL   / TREASURY ADMIN
STATUS     / REVIEW REQUIRED
```

Use the summary before the recipient-level table. A community treasurer must understand risk before approving the batch.

### Buttons

Solvo uses few buttons.

- Primary action: transparent background, 1px `rgba(255,255,255,0.15)` border, off-white label, `10px 24px` padding, `2px` radius.
- Hover: border brightens to `rgba(255,255,255,0.35)`; no fill change.
- Destructive/cancel action: text link or same outline treatment; never saturated red.
- Telegram deep link: can use the same outline action; do not imitate Telegram’s blue brand palette.
- Never use a filled coloured CTA.

### Cards

- Main card: `#232323`, `4px` radius, subtle border, one soft ambient shadow.
- Receipt card: same surface and radius, with a clear top label and structured rows.
- Bottom feature cells: one continuous strip with vertical hairlines; no individual shadows.
- Keep card count low. Do not turn every piece of copy into a panel.

### Lamp and custom SVG

There is exactly one illustrated element on the landing page: the pendant lamp.

Required elements:

- small ceiling mount;
- bent or kinked cable with a slight adjustable jog;
- dark conical or dome shade;
- visible white bulb;
- soft radial glow beneath the bulb.

For Solvo, the lamp has a product meaning:

- cable = the request travelling through the execution system;
- shade = policy and approval containing risk;
- bulb = confirmed value movement;
- glow = evidence that the transaction reached a verifiable state.

The cable should not become an abstract blockchain network. It is one path from intent to completion.

Stroke widths:

- cable and structural lines: `2px`;
- small arrows and UI lines: `1.5px`;
- cable colour: `#2E2E2E`;
- structural accent: low-opacity `#EDEDED`.

No second illustration, mascot, coin, wallet, robot, chain, token pile or decorative chart should appear in the hero.

## Interaction & Motion

- Page load: lamp and ghosted wordmark fade in first over `600ms`.
- Visible wordmark and headline follow with a `200ms` stagger.
- Navigation fades in last.
- Use opacity only on initial load; do not slide or scale the composition.
- The lamp glow may breathe almost imperceptibly over `4s`.
- Execution Line transitions use opacity and a short colourless emphasis, not a racing animation.
- Status changes should be announced in text for assistive technology.
- Respect `prefers-reduced-motion` by removing glow breathing and all staged transitions.
- No parallax, scroll-jacking or autoplay narrative.

## Responsive Behaviour

- At mobile widths, card padding reduces to `24px`.
- The lamp remains centred and overlaps the card edge.
- The ghosted `SOLVO` wordmark scales down but remains oversized relative to the visible wordmark.
- The three feature cells become a vertical stack with horizontal hairlines.
- Receipt rows remain readable; long hashes truncate with a visible copy action or full-value expansion.
- The amount, destination and current status remain above the fold.
- Navigation can collapse to text links or a minimal menu, but the single-light-source composition remains.

## Accessibility

- Never encode status with lightness alone; use explicit state words.
- Body text must be readable against `#232323` and `#141414`.
- Focus states use a visible off-white outline or double-line treatment.
- All transaction actions have text labels.
- Destination addresses and hashes are selectable and copyable.
- Error messages explain the cause and next safe action.
- Simulated results always state that no funds moved.
- Motion is optional and removable.

## Do's and Don'ts

### Do

- Make amount, destination, approval requirement and status easy to find.
- Use the Execution Receipt as the repeated proof asset.
- Treat the lamp as a metaphor for confirmed execution.
- Preserve darkness as a calm trust signal, not as decoration.
- Use sparse copy and direct state names.
- Keep the interface quiet until a decision or proof needs attention.
- Use the same Execution Line in landing, Telegram previews, receipts and demo slides.

### Don't

- Add an accent colour to make the page feel more energetic.
- Use neon blockchain gradients, coins, chains or AI glow effects.
- Use generic chat bubbles as the brand symbol.
- Hide the destination address behind clever copy.
- Show a success state before KeeperHub confirmation.
- Use confetti, trophies, streaks or celebratory payment animations.
- Turn every feature into a separate card.
- Let the lamp become a decorative illustration unrelated to the transaction.
- Use thin low-contrast type for money, status or error information.
- Call a simulated transaction “complete.”

## Implementation Notes

The design is intentionally small enough for the hackathon MVP:

- SvelteKit landing and claim page;
- dark single-card shell;
- receipt and Execution Line components;
- no dashboard dependency for the first real transaction;
- Telegram handles the operational workflow;
- receipt data comes from persisted payout and execution state;
- the lamp and ghosted wordmark are CSS/SVG assets, not a dependency on external imagery.

The visual system must remain credible when the landing page is replaced by a transaction receipt. Proof is the brand moment.
