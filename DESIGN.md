---
version: alpha
name: Solvo
description: "A black and orange execution interface for truthful, KeeperHub-backed payment coordination."
colors:
  void: "#070707"
  vignette: "#030303"
  surface: "#11100f"
  primary: "#f5f3f0"
  secondary: "#aaa6a1"
  muted: "#77736f"
  faint: "#615e5a"
  line: "rgba(255, 255, 255, 0.085)"
  border: "rgba(255, 255, 255, 0.1)"
  solvo-orange: "#ff7417"
  solvo-orange-soft: "#ffb166"
  state-complete: "#c8c8c8"
  state-pending: "#999999"
  state-error: "#d6d6d6"
typography:
  sans:
    fontFamily: "Helvetica Neue, Arial, Helvetica, sans-serif"
  display:
    fontFamily: "Helvetica Neue, Arial, Helvetica, sans-serif"
  data:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
---

## Overview

Solvo coordinates USDC payments from Telegram and exposes the checks, approval, execution, and proof produced through KeeperHub. Its current visual system is black, warm white, and signal orange: a reference-inspired marketing composition paired with restrained operational surfaces. The interface must look technical without implying that decorative activity is financial progress.

## Colors

Black is the dominant field. `void` governs the site substrate, while `surface` separates panels and operator work areas. White and gray establish the reading hierarchy.

Orange is the sole brand signal. Use it for the Solvo point, execution badge, artwork energy, active navigation markers, focus emphasis, and thin structural accents. It may identify attention or active position, but must not carry a financial state by itself. Every pending, failed, approved, simulated, or completed state requires text.

Public panels combine restrained borders with a warm orange radial trace. Keep proof values and body copy neutral so the accent does not compete with amounts, recipients, hashes, or warnings.

## Typography

Use the shared sans family for navigation, prose, and display copy. Homepage display roles use tight tracking, high weight for the primary title, and a lighter large descriptor. Public-page headings are smaller and optimized for reading rather than spectacle.

Use the data family for addresses, transaction hashes, execution identifiers, amounts where alignment matters, and compact execution labels. Long identifiers must remain selectable and wrap safely.

Uppercase tracked labels are for short section names and states only. Do not apply display tracking to financial values, error explanations, or paragraphs.

## Layout

The homepage is a large rounded landing panel inside the shared substrate. Navigation belongs inside the panel. The centered hero stacks the KeeperHub badge, exact approved title and descriptor, two actions, and an abstract execution core over a subtle line grid. The six labels around the artwork describe requested, validated, approved, KeeperHub, executed, and proved states; they are explanatory labels, not a live progress indicator.

The homepage follows the reference through composition—dark framed panel, capsule navigation, centered oversized copy, sparse actions, and a luminous central object—without copying obsolete pendant-lamp or typing-wordmark motifs. Below the hero, sections return to quieter hairline-separated content.

Public routes use `PageShell`, the shared site width, primary navigation, and footer. Page heroes and content panels use the same dark rounded family, subtle orange trace, and generous internal spacing. Community, individual, process, security, judge, sandbox, claim, and receipt surfaces must preserve this hierarchy while adapting content density.

The dashboard is an operator workspace, not another landing page. On desktop it uses a fixed-width sidebar beside one contained work surface. On mobile the shell stacks and section navigation becomes a disclosure menu. Content must remain usable without horizontal page scrolling.

## Elevation & Depth

Depth comes from near-black planes, restrained borders, inset highlights, and broad low-opacity shadows. The homepage may use orange radial illumination behind its abstract execution artwork. Public and dashboard panels use quieter traces.

Do not restore the lamp as the brightest source, use glass effects as decoration, or make proof cards glow. Financial hierarchy must come from structure and typography.

## Shapes

The approved system uses rounded framed surfaces: the landing panel is broad and prominent; public heroes and content panels form a related large-radius family; dashboard links and controls use smaller radii; navigation may use capsules. Hairlines divide related rows within a surface.

Pills are appropriate for compact navigation, badges, and written status labels. They are not general-purpose containers for paragraphs or financial records.

## Components

### Brand and navigation

`Wordmark` is the single replacement seam for the temporary text logo used by public and dashboard navigation. Replace its internals when final logo artwork is approved; do not duplicate brand assets in each shell. Preserve the “Solvo home” accessible name wherever the mark links home.

Desktop public navigation presents Product, How it works, Telegram, and Open Solvo. Product targets `/#product`. Mobile navigation may expose additional public routes, must communicate expanded state, close on Escape, and restore focus to its trigger.

### Homepage artwork

`HeroArtwork` is decorative inline SVG supported by CSS gradients, circuit paths, and orange core light. Keep it hidden from assistive technology because the adjacent six written labels and hero copy carry the meaning. The active homepage must not render `Lamp` or `HeroTypingWordmark`.

### Public content panels

Page heroes establish route context. Content panels group one coherent explanation, decision, or proof. Nested rows use hairlines rather than independent floating cards. Keep primary information in heading order and avoid turning every paragraph into a separate panel.

### Financial primitives

Payment previews show destination and amount before approval. Placeholder approval controls remain disabled and explicitly say that the preview is not connected.

Batch summaries precede recipient-level detail and expose recipients, total, validation, duplicates, approval, and a written status. Missing values render as an em dash; they are never fabricated.

Execution receipts preserve the supplied field order and emphasize amount, recipient, and transaction hash. A completed state requires execution evidence. Simulation copy must state that no funds moved and must never call a simulation a transaction. Hashes and addresses must wrap, remain selectable, and retain semantic label/value markup.

### Dashboard navigation

The dashboard marks exact and nested active routes with `aria-current="page"`, a surface change, readable text, and an orange positional marker. The marker is supplementary, not the only active-state cue. The mobile menu closes after pathname changes and supports Escape with focus return.

## Do's and Don'ts

### Do

- Use black planes, warm neutral text, and orange as a controlled brand signal.
- Keep destination, amount, approval requirement, execution state, and proof easy to scan.
- Pair every state color or marker with explicit language.
- Preserve visible keyboard focus and remove nonessential motion when reduced motion is requested.
- Distinguish unavailable, simulated, pending, executed, failed, and proved states truthfully.
- Keep the homepage artwork CSS/SVG-based and decorative.

### Don't

- Restore the monochrome lamp, ghost wordmark, or typing animation as the active homepage identity.
- Call a simulation complete or imply that funds moved without execution evidence.
- Enable placeholder financial controls or invent values for empty states.
- Hide addresses, hashes, failure causes, or the next safe action.
- Rely on orange, lightness, animation, or position alone to communicate status.
- Duplicate logo implementation outside the shared `Wordmark` seam.
