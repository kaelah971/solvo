# Solvo Precision Instrument Elevation Plan

**Goal:** Add purposeful light, action, and interaction hierarchy to the Solvo landing hero while preserving its monochrome lamp-centered identity.

### Task 1: Red UI contracts

Update landing/shared source tests first for the stationary full-word ghost, lamp rays and center-letter illumination, hero Telegram CTA, interactive nav/CTA states, anchor execution strip, reduced motion, and lamp regression guard. Confirm only the new requirements fail.

### Task 2: Hero light and action

Update the hero wordmark component, landing composition, and CSS to add the full faint ghost, stationary rays, letter illumination, tightened spacing, and hero Telegram CTA. Preserve the lamp component and typing behavior. Run focused tests, lint, and TypeScript.

### Task 3: Interaction states and execution strip

Update SiteNav, Cta/TelegramCta styles, ExecutionStrip, target section scroll positions, and reduced-motion CSS. Make strip cells real anchors while keeping one continuous row. Run focused tests, lint, TypeScript, and build.

### Task 4: Browser fidelity QA

Capture the four required viewports, verify typing phases and light interaction on letters, hover/focus states, anchors, mobile menu, overflow, reduced motion, console, and compare against the accepted reference/current screenshot. Fix P0-P2 issues and rerun all gates.

