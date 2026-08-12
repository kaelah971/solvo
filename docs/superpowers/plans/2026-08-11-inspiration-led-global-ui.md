# Inspiration-Led Global UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Solvo landing page to match the supplied lamp reference and carry the resulting full-width, restrained visual system across every existing application route.

**Architecture:** Keep the Next.js App Router structure and existing product behavior. Concentrate the visual system in `globals.css` and shared components (`PageShell`, `SiteNav`, `Footer`, and existing primitives), then rebuild `/` as a reference-led hero followed by improved existing content. Use source-contract tests for exact copy and prohibited layout patterns, followed by real browser capture and design QA for visual fidelity.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript 5, Tailwind CSS 4, Node's built-in test runner, ESLint.

## Global Constraints

- Preserve all existing routes, content semantics, business logic, Telegram configuration, claim flows, sandbox controls, judge-demo controls, and receipt behavior.
- Use one continuous charcoal field with no separate black outer background or floating central page plane.
- Use the existing local-first `"Helvetica Neue", Arial, Helvetica, sans-serif` stack; add no font or UI dependency.
- Keep the exact hero wordmark `SOLVO` and support copy `Telegram payment coordination with KeeperHub-backed proof.`
- Keep the exact execution strip copy defined in the approved specification.
- The hero arrows are decorative and must use `aria-hidden="true"` rather than interactive elements.
- Do not add generated imagery, new icon packs, new routes, database changes, or backend changes.
- Preserve unrelated working-tree changes and do not stage or commit implementation files unless the user explicitly asks.
- Before every target edit, reread the file and use a narrow `apply_patch`; do not replace whole files that already contain user changes.

---

## File Map

- `src/app/globals.css`: global color tokens, continuous page substrate, shared layout utilities, motion, focus, and responsive hero rules.
- `src/app/page.tsx`: reference-led landing hero and improved existing landing sections.
- `src/components/PageShell.tsx`: common full-width route shell with a centered inner content wrapper.
- `src/components/SiteNav.tsx`: exact desktop navigation, small `S` mark, and accessible mobile menu.
- `src/components/Lamp.tsx`: compact lamp geometry with bulb attached to the shade and a restrained glow.
- `src/components/GhostWordmark.tsx`: modest responsive ghost wordmark rather than viewport-dominating letters.
- `src/components/Wordmark.tsx`: visible tracked `SOLVO` mark and optional compact mark support.
- `src/components/ExecutionStrip.tsx`: exact numbered, hairline-divided three-part strip.
- `src/components/Footer.tsx`: quiet shared footer on the same continuous substrate.
- `src/components/Cta.tsx`, `src/components/TelegramCta.tsx`: restrained outline and text-action treatments used across routes.
- `src/components/StatePanel.tsx`, `src/components/PolicyRow.tsx`, `src/components/ProofRow.tsx`: shared surface and row treatments that propagate the redesign to data-heavy routes.
- `src/components/AgentChecks.tsx`, `src/components/EmptyState.tsx`, `src/components/ExecutionLine.tsx`, `src/components/SectionLabel.tsx`, `src/components/StatusLabel.tsx`: shared landing and route states that must use the same continuous, hairline-led treatment.
- `tests/ui/landing-source.test.ts`: exact landing copy, accessibility, and prohibited-pattern contracts.
- `tests/ui/shared-shell-source.test.ts`: shared shell and navigation contracts for all routes.
- `design-qa.md`: viewport-by-viewport comparison report and final pass gate.

---

### Task 1: Add UI source-contract tests

**Files:**
- Create: `tests/ui/landing-source.test.ts`
- Create: `tests/ui/shared-shell-source.test.ts`

**Interfaces:**
- Consumes: UTF-8 source files under `src/app` and `src/components`.
- Produces: Node test contracts runnable with `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts`.

- [ ] **Step 0: Capture the dirty-worktree baseline before any implementation edit**

Run: `git status --short`

Run: `git diff --name-only`

Expected: record the complete pre-existing modified/untracked file list in the task notes. Every later worker must compare against this baseline and edit only assigned files with narrow patches.

- [ ] **Step 1: Write the failing landing source contract**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/page.tsx", "utf8");
const strip = readFileSync("src/components/ExecutionStrip.tsx", "utf8");

test("landing uses the approved compact hero copy", () => {
  assert.match(page, /<Wordmark/);
  assert.match(page, /Telegram payment coordination with KeeperHub-backed proof\./);
  assert.match(page, /<h1[^>]*className="sr-only"[^>]*>Solvo<\/h1>/);
  assert.doesNotMatch(page, /<h1[^>]*>[^<]*From instruction/s);
  assert.doesNotMatch(page, /See the execution path/);
});

test("landing includes decorative arrows and one hero execution strip", () => {
  assert.equal((page.match(/className="hero-arrow [^"]*" aria-hidden="true"/g) ?? []).length, 2);
  assert.equal((page.match(/<ExecutionStrip/g) ?? []).length, 1);
  for (const text of [
    "01", "Check", "Validate addresses, amounts and limits.",
    "02", "Execute", "Simulate and submit through KeeperHub.",
    "03", "Prove", "Return the hash and audit record.",
  ]) assert.match(strip, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
```

- [ ] **Step 2: Write the failing shared-shell contract**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("src/components/PageShell.tsx", "utf8");
const nav = readFileSync("src/components/SiteNav.tsx", "utf8");
const telegram = readFileSync("src/components/TelegramCta.tsx", "utf8");

test("shared shell has one continuous substrate", () => {
  assert.match(shell, /site-substrate/);
  assert.match(shell, /site-inner/);
  assert.doesNotMatch(shell, /main-plane/);
});

test("desktop navigation uses the approved links", () => {
  const primary = nav.slice(nav.indexOf("const primaryLinks"), nav.indexOf("const menuLinks"));
  assert.match(primary, /Product/);
  assert.match(primary, /How it works/);
  assert.doesNotMatch(primary, /Security/);
  assert.match(nav, /variant="text"/);
  assert.match(nav, /aria-expanded=\{open\}/);
  assert.match(nav, /aria-controls="site-menu"/);
  assert.match(telegram, /variant\?: "outline" \| "text"/);
  assert.match(telegram, /showConfigurationNote\?: boolean/);
});
```

- [ ] **Step 3: Run the tests and verify the expected red state**

Run: `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts`

Expected: FAIL with two test files discovered and at least one failing assertion because the current page still contains the oversized headline, duplicate execution strip placement, `main-plane`, and the old primary navigation. A report of zero discovered tests is a command failure, not a valid red state.

- [ ] **Step 4: Keep the tests uncommitted**

Run: `git status --short -- tests/ui`

Expected: only the two new UI test files are reported under this task; do not stage them because the repository contains pre-existing user changes.

---

### Task 2: Refactor the shared visual substrate and primitives

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/PageShell.tsx`
- Modify: `src/components/SiteNav.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `src/components/Wordmark.tsx`
- Modify: `src/components/Lamp.tsx`
- Modify: `src/components/GhostWordmark.tsx`
- Modify: `src/components/Cta.tsx`
- Modify: `src/components/TelegramCta.tsx`

**Interfaces:**
- Consumes: existing route children, `TELEGRAM_BOT_URL` behavior from the current Telegram CTA, and Next.js `Link`/`usePathname`.
- Produces: `PageShell({ children, className? })`, `SiteNav()`, `Lamp({ className? })`, `GhostWordmark({ className? })`, and existing CTA signatures without breaking callers.

- [ ] **Step 1: Replace the framed-card CSS with the continuous substrate**

Implement these shared classes in `globals.css`, retaining existing color tokens and data/focus utilities:

```css
body {
  margin: 0;
  background: var(--color-void);
  color: var(--color-primary);
  font-family: "Helvetica Neue", Arial, Helvetica, sans-serif;
}

.site-substrate {
  min-height: 100vh;
  background: radial-gradient(ellipse 82% 58% at 50% 28%, var(--color-surface) 0%, var(--color-void) 58%, var(--color-vignette) 140%);
}

.site-inner {
  width: min(calc(100% - 48px), 1180px);
  margin-inline: auto;
}

.hero-arrow {
  position: absolute;
  top: 50%;
  color: var(--color-faint);
  font-size: 14px;
}

@media (max-width: 640px) {
  .site-inner { width: min(calc(100% - 32px), 1180px); }
}
```

Delete `.main-plane` and ensure `.page-vignette` is no longer used as a contrasting outer layer.

- [ ] **Step 2: Refactor `PageShell` to one substrate and one transparent inner wrapper**

```tsx
export function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className="site-substrate min-h-screen">
      <div className="site-inner flex min-h-screen flex-col">
        <SiteNav />
        <main className={`flex-1 ${className}`}>{children}</main>
        <Footer />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Refactor `SiteNav` while preserving mobile behavior**

Set `primaryLinks` to:

```ts
const primaryLinks = [
  { label: "Product", href: "/community" },
  { label: "How it works", href: "/how-it-works" },
] as const;
```

Render an `S` link at the left, the two links plus `<TelegramCta variant="text" showConfigurationNote={false} />` at the right, and retain the accessible `Menu`/`Close` button and current complete mobile route list. Extend `TelegramCta` with backward-compatible optional props `variant?: "outline" | "text"` and `showConfigurationNote?: boolean`, defaulting to `"outline"` and `true`, so below-fold and route CTAs keep the existing configuration explanation.

- [ ] **Step 4: Compact the lamp and ghost wordmark**

Keep `Lamp` as the existing SVG component, but change its view box and geometry so the shade ends immediately above the bulb:

```tsx
<svg viewBox="0 0 180 250" role="img" aria-label="Pendant lamp marking confirmed execution">
  {/* cable ends at y=142; shade spans y=142 through y=178; bulb center is y=180 */}
</svg>
```

Keep the current monochrome colors, reduce the glow ellipse to approximately `rx=52`, `ry=28`, and cap the rendered desktop lamp width at 150 pixels. Change the ghost wordmark to responsive `clamp(3.75rem, 11vw, 8rem)` sizing with `0.12em` tracking.

- [ ] **Step 5: Align shared actions and footer**

Keep CTA component props unchanged. Use transparent surfaces, one-pixel borders, two-pixel radii, compact uppercase labels, and at least 44-pixel interactive height. Remove any footer background plane; retain the route links and proof statement behind a single top hairline.

Add `hero-enter`, `hero-enter-delayed`, and `lamp-breathe` classes using opacity-only entry keyframes and a four-second glow cycle. In the existing `prefers-reduced-motion` block, set these animations to `none`. Never render `text-faint` for essential text smaller than 18 pixels; use `text-muted` or a token with at least 4.5:1 contrast for small labels.

- [ ] **Step 6: Run shared-shell tests**

Run: `node --test tests/ui/shared-shell-source.test.ts`

Expected: PASS.

- [ ] **Step 7: Run lint on the shared files**

Run: `npx eslint src/app/globals.css src/components/PageShell.tsx src/components/SiteNav.tsx src/components/Footer.tsx src/components/Wordmark.tsx src/components/Lamp.tsx src/components/GhostWordmark.tsx src/components/Cta.tsx src/components/TelegramCta.tsx`

Expected: exit code 0. If ESLint reports that CSS is outside its configured file set, rerun the same command without `src/app/globals.css` and rely on the production build for CSS validation.

---

### Task 3: Rebuild the landing page around the reference composition

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/ExecutionStrip.tsx`

**Interfaces:**
- Consumes: `SiteNav`, `Lamp`, `GhostWordmark`, `Wordmark`, `ExecutionStrip`, existing proof/state components, and configured Telegram CTA behavior.
- Produces: a single first-viewport `<section className="landing-hero">` containing exactly one `ExecutionStrip`, followed by the preserved product sections.

- [ ] **Step 1: Build the first-viewport hierarchy**

Use this structural order in `page.tsx`:

```tsx
<div className="site-substrate min-h-screen">
  <div className="site-inner">
    <SiteNav />
    <main>
      <section className="landing-hero relative flex min-h-[calc(100svh-84px)] flex-col">
        <div className="hero-arrow left-0" aria-hidden="true">←</div>
        <div className="hero-arrow right-0" aria-hidden="true">→</div>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h1 className="sr-only">Solvo</h1>
          <Lamp className="landing-lamp" />
          <GhostWordmark />
          <Wordmark />
          <p>Telegram payment coordination with KeeperHub-backed proof.</p>
        </div>
        <ExecutionStrip />
      </section>
    </main>
    <Footer />
  </div>
</div>
```

The lamp and ghost wordmark may overlap through positioned wrappers, but the visible wordmark and support line must remain legible and centered.

- [ ] **Step 2: Keep the execution strip exact and compact**

Retain this data in `ExecutionStrip.tsx`:

```ts
const stripItems = [
  { index: "01", title: "Check", body: "Validate addresses, amounts and limits." },
  { index: "02", title: "Execute", body: "Simulate and submit through KeeperHub." },
  { index: "03", title: "Prove", body: "Return the hash and audit record." },
] as const;
```

Render one continuous grid with top and bottom hairlines, vertical desktop dividers, 20-28 pixels of cell padding, and horizontal mobile dividers.

- [ ] **Step 3: Recompose the existing sections below the hero**

Keep the following order and components:

```tsx
<section id="product-introduction" className="content-section">
  <SectionLabel>The execution receipt</SectionLabel>
  <p>Solvo turns a payment instruction into a validated, approved, executed, and auditable USDC transaction.</p>
  <TelegramCta />
</section>
<section id="execution-line" className="content-section">
  <ExecutionLine stages={executionStages} announce="Request, check, approve, execute, prove." />
</section>
<section id="check" className="content-section">
  <AgentChecks items={[]} emptyLabel="Waiting for a payment instruction" emptyDescription="Checks appear here when a request begins." />
</section>
<section id="use-cases" className="content-section grid md:grid-cols-2">
  <Cta href="/community">Community treasury</Cta>
  <Cta href="/individuals">Personal payments</Cta>
</section>
<section id="prove" className="content-section">
  <ExecutionReceipt reference="-" fields={receiptFields} status={{ label: "Waiting for a payment instruction", tone: "pending" }} />
</section>
<section id="final-action" className="content-section">
  <TelegramCta />
</section>
```

Reuse the current copy and components for these sections, remove the old three-column “Interpret / Check & approve / Execute & prove” block, and remove the former duplicate `ExecutionStrip` section. Use two-column text/proof layouts from 900 pixels upward, max 640-pixel text width, max 760-pixel proof width, and the spacing values from the approved spec.

- [ ] **Step 4: Run the landing tests**

Run: `node --test tests/ui/landing-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Run lint on the landing files**

Run: `npx eslint src/app/page.tsx src/components/ExecutionStrip.tsx tests/ui/landing-source.test.ts`

Expected: exit code 0.

---

### Task 4: Propagate the visual system through shared route primitives

**Files:**
- Modify: `src/components/StatePanel.tsx`
- Modify: `src/components/PolicyRow.tsx`
- Modify: `src/components/ProofRow.tsx`
- Modify: `src/components/PaymentPreview.tsx`
- Modify: `src/components/BatchSummary.tsx`
- Modify: `src/components/ExecutionReceipt.tsx`
- Modify: `src/components/AgentChecks.tsx`
- Modify: `src/components/EmptyState.tsx`
- Modify: `src/components/ExecutionLine.tsx`
- Modify: `src/components/SectionLabel.tsx`
- Modify: `src/components/StatusLabel.tsx`
- Review without changing unless required: every `src/app/**/page.tsx` route using `PageShell`

**Interfaces:**
- Consumes: existing props and field data passed by claim, receipt, sandbox, judge, community, individuals, security, and how-it-works pages.
- Produces: identical component signatures and semantics with continuous surfaces, hairline grouping, compact headings, and readable financial data.

- [ ] **Step 1: Audit component signatures before editing**

Run: `rg -n "<(StatePanel|PolicyRow|ProofRow|PaymentPreview|BatchSummary|ExecutionReceipt|AgentChecks|EmptyState|ExecutionLine|SectionLabel|StatusLabel)" src/app src/components`

Expected: a complete caller list. Record each prop name locally and preserve every signature.

- [ ] **Step 2: Replace isolated card styling with continuous proof surfaces**

Apply this common treatment without changing component logic:

```tsx
className="border-y border-line bg-white/[0.015]"
```

Use internal `divide-y divide-line`, two-pixel maximum radii only where an interactive field needs a visible boundary, tabular numerals for amounts/IDs, and unchanged written status labels.

In `ExecutionReceipt`, map field labels to emphasis classes without reordering data: `Amount`, `Recipient`, and `Transaction hash` use `text-primary`, status remains the highest-contrast written state, and secondary IDs stay `text-muted`. Preserve links and copy controls.

- [ ] **Step 3: Preserve route behavior and verify page-shell coverage**

Run: `rg -L "PageShell" src/app -g "page.tsx"`

Expected: only `/` may intentionally use the substrate directly. All current non-root routes already use `PageShell`; do not edit route files under this task.

- [ ] **Step 4: Run TypeScript and targeted lint**

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npx eslint src/components/StatePanel.tsx src/components/PolicyRow.tsx src/components/ProofRow.tsx src/components/PaymentPreview.tsx src/components/BatchSummary.tsx src/components/ExecutionReceipt.tsx src/components/AgentChecks.tsx src/components/EmptyState.tsx src/components/ExecutionLine.tsx src/components/SectionLabel.tsx src/components/StatusLabel.tsx`

Expected: exit code 0.

---

### Task 5: Run full verification and visual design QA

**Files:**
- Create: `design-qa.md`
- Modify only if QA finds discrepancies: files listed in Tasks 2-4.

**Interfaces:**
- Consumes: approved reference `C:\Users\emman\Downloads\Telegram Desktop\ui.jpg`, current comparison `C:\Users\emman\OneDrive\Pictures\Screenshots\Screenshot (1380).png`, and the running Next.js app.
- Produces: `design-qa.md` ending with exactly `final result: passed` when no P0-P2 issue remains.

- [ ] **Step 1: Run the entire automated verification set**

Run: `npm test`

Expected: all existing KeeperHub tests pass.

Run: `node --test tests/ui/landing-source.test.ts tests/ui/shared-shell-source.test.ts`

Expected: both UI test files are discovered and all UI source contracts pass; zero discovered tests is a failure.

Run: `npm run lint`

Expected: exit code 0.

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 2: Start the app for browser verification**

Run: `npm run dev -- --hostname 127.0.0.1 --port 3000`

Expected: Next.js reports a ready local server at `http://127.0.0.1:3000`.

- [ ] **Step 3: Capture and compare exact viewports**

Use the in-app browser to capture `/` at 800x600, 1920x1080, 390x844, and 844x390. Compare each capture with `ui.jpg` and the prior recreation. Check the same initial, menu-closed state and confirm the execution strip is reachable without overlap or clipping. Also capture `/community` and `/sandbox` at 1280x800 and 390x844, plus a representative available `/receipt/[id]` or `/claim/[token]` state at 1280x800. Confirm there is no horizontal overflow.

- [ ] **Step 4: Write the QA report**

For each capture, record the real first-pass observation before fixing anything. Use this structure in `design-qa.md`; repeat the viewport block for every landing and internal-route capture:

```md
# Design QA

## 800x600
- Evidence: `design-qa/home-800x600.png`
- First-pass difference: record the observed comparison in concrete terms.
- Severity: record P0, P1, P2, P3, or None.
- Resolution and retest: record the applied fix and recapture result, or state that no fix was needed.

## Remaining P3 polish
- List each remaining minor issue, or write `None`.
```

P0 means unusable or missing content; P1 means a major structural mismatch; P2 means a clearly visible spacing, type, color, or responsive mismatch; P3 means minor polish. Append `final result: passed` only after all observations, fixes, and recaptures are complete and no P0-P2 remains.

- [ ] **Step 5: Fix and repeat for P0-P2 findings**

For every P0-P2 finding, edit the smallest responsible shared or landing file, rerun its targeted test and lint command, capture the same viewport again, and update its report entry. Stop only when the report ends with `final result: passed`.

- [ ] **Step 6: Exercise representative interactions**

Verify the desktop navigation, mobile menu open/close and route selection, Telegram CTA configured/unconfigured state, community and individual route links, claim form controls, sandbox controls, judge-demo controls, and receipt copy/link actions. Use keyboard-only navigation to verify tab order, visible focus, link activation, menu Escape behavior, and focus return. Check 200% zoom/reflow, accessible landmark/name output, 44-pixel targets, reduced-motion behavior, computed `.site-inner` width, and WCAG AA contrast for small text. Treat runtime/page errors introduced by this work as at least P1; record unrelated pre-existing warnings separately.

- [ ] **Step 7: Review the final working-tree scope**

Run: `git status --short`

Run: `git diff --check`

Expected: no whitespace errors; only planned UI/test/QA files plus pre-existing user changes are present. Do not stage or commit implementation files without explicit user authorization.
