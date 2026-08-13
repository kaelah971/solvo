import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landing = readFileSync("src/app/page.tsx", "utf8");
const artwork = readFileSync("src/components/HeroArtwork.tsx", "utf8");
const siteNav = readFileSync("src/components/SiteNav.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");
const wordmark = readFileSync("src/components/Wordmark.tsx", "utf8");
const cta = readFileSync("src/components/Cta.tsx", "utf8");

const compact = (source: string) => source.replace(/\s+/g, " ");

test("the landing panel contains the primary navigation and approved hero", () => {
  const source = compact(landing);

  assert.match(source, /<div className="landing-panel"> <SiteNav \/> <section className="landing-hero/);
  assert.match(source, /<h1 className="hero-title"> Meet! <span className="hero-title-accent">Solvo<\/span> <\/h1>/);
  assert.match(
    source,
    /<p className="hero-description"> Telegram payment coordination with KeeperHub-backed proof\. <\/p>/,
  );
  assert.match(source, /KeeperHub-backed \/ Web3 execution/);
});

test("hero copy uses explicit display roles and approved actions", () => {
  assert.match(landing, /className="hero-title"/);
  assert.match(landing, /className="hero-description"/);
  assert.match(landing, /label="Open Solvo"/);
  assert.match(landing, /<Cta href="#product" variant="dark">Learn more<\/Cta>/);
});

test("desktop navigation exposes Product, How it works, Telegram, and Open Solvo", () => {
  for (const contract of [
    /label: "Product", href: "\/#product"/,
    /label: "How it works", href: "\/#how-it-works"/,
    /label="Telegram"[\s\S]*variant="text"/,
    /label="Open Solvo"[\s\S]*variant="light"/,
  ]) {
    assert.match(siteNav, contract);
  }
  assert.match(siteNav, /aria-label="Primary"/);
  assert.match(siteNav, /aria-label="Solvo home"/);
});

test("homepage uses the supplied full-bleed image, compact orb, and six execution labels", () => {
  assert.match(landing, /<HeroArtwork \/>/);
  assert.match(landing, /import Image from "next\/image"/);
  assert.match(landing, /ChatGPT%20Image%20Aug%2013%2C%202026%2C%2003_11_46%20PM\.png/);
  assert.match(landing, /<Image[\s\S]*fill[\s\S]*priority/);
  assert.match(artwork, /<svg\b/);
  assert.match(artwork, /aria-hidden="true"/);
  assert.doesNotMatch(artwork, /hero-(?:flames|columns|circuit)/);

  for (const label of ["Requested", "Validated", "Approved", "KeeperHub", "Executed", "Proved"]) {
    assert.match(landing, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.equal(landing.match(/className="hero-state hero-state-/g)?.length, 6);
});

test("obsolete lamp and typing components are absent from the active homepage", () => {
  assert.doesNotMatch(landing, /import\s+\{?\s*(?:Lamp|HeroTypingWordmark)\b/);
  assert.doesNotMatch(landing, /<(?:Lamp|HeroTypingWordmark)\b/);
});

test("black and orange homepage tokens govern its panel and grid treatment", () => {
  assert.match(globals, /--color-solvo-orange:\s*#ff7417/);
  assert.match(globals, /\.home-page\.site-substrate\s*\{[\s\S]*background-color:\s*#060606/);
  assert.match(globals, /\.landing-panel\s*\{[\s\S]*border-radius:[^;]+;[\s\S]*background:\s*#080808/);
  assert.match(globals, /\.hero-background-image\s*\{[\s\S]*object-fit:\s*cover[\s\S]*object-position:\s*center bottom/);
  assert.match(globals, /\.execution-badge-dot\s*\{[\s\S]*var\(--color-solvo-orange\)/);
});

test("the shared wordmark uses the supplied image and crops its margin", () => {
  assert.match(wordmark, /import Image from "next\/image"/);
  assert.match(wordmark, /photo_2026-08-13_17-01-38\.jpg/);
  assert.match(wordmark, /alt="Solvo"/);
  assert.doesNotMatch(wordmark, />\s*Solvo\s*</);
  assert.match(globals, /\.solvo-wordmark\s*\{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px/);
  assert.match(globals, /\.solvo-wordmark-image\s*\{[\s\S]*object-fit:\s*cover;[\s\S]*transform:\s*scale\(1\.56\)/);
});

test("actions use glossy orange and charcoal surfaces while disabled copy stays readable", () => {
  assert.match(cta, /light:\s*"cta-light border-\[#ff7417\] bg-\[#ff7417\] text-\[#160b05\]"/);
  assert.match(cta, /light:\s*"border-\[#b95516\] bg-\[#b95516\] text-\[#160b05\] opacity-80"/);
  assert.doesNotMatch(cta, /bg-white|border-white/);
  assert.match(cta, /aria-disabled="true"/);
  assert.match(cta, /cta-shell/);
  assert.match(globals, /\.cta-light\s*\{[\s\S]*linear-gradient[\s\S]*box-shadow/);
  assert.match(globals, /\.cta-dark,[\s\S]*\.cta-outline\s*\{[\s\S]*linear-gradient/);
  assert.match(globals, /\.cta-shell\[aria-disabled="true"\]/);
});

test("desktop panel is viewport-bounded and the generated artwork stays compact", () => {
  assert.match(globals, /height:\s*calc\(100svh - 24px\)/);
  assert.match(globals, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(globals, /\.hero-description\s*\{[\s\S]*"Arial Narrow"[\s\S]*font-weight:\s*300/);
  assert.match(globals, /\.hero-artwork\s*\{[\s\S]*width:\s*clamp\(116px, 15vw, 178px\)/);
  assert.doesNotMatch(artwork, /solvo-flame|solvo-column/);
});

test("hero and decorative motion have a reduced-motion fallback", () => {
  const reduced = globals.match(
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/,
  )?.[0] ?? "";

  assert.ok(reduced, "expected a reduced-motion media query");
  assert.match(reduced, /animation-duration:\s*0\.01ms !important/);
  assert.match(reduced, /scroll-behavior:\s*auto !important/);
  assert.match(globals, /\.hero-state\s*\{[\s\S]*animation:\s*hero-state-float/);
  assert.match(reduced, /\.hero-state/);
});

test("mobile hero actions stay compact and wrap only on very narrow screens", () => {
  assert.match(globals, /@media \(max-width: 640px\)[\s\S]*\.hero-actions\s*\{[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(globals, /\.hero-actions > \*\s*\{[\s\S]*padding-inline:\s*17px/);
  assert.match(globals, /@media \(max-width: 350px\)[\s\S]*flex-wrap:\s*wrap/);
});
