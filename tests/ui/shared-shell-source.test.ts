import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const pageShell = read("src/components/PageShell.tsx");
const siteNav = read("src/components/SiteNav.tsx");
const dashboardNav = read("src/components/DashboardNav.tsx");
const dashboardLayout = read("src/app/app/layout.tsx");
const wordmark = read("src/components/Wordmark.tsx");
const globals = read("src/app/globals.css");

test("public pages inherit the shared substrate, width, navigation, and footer", () => {
  assert.match(pageShell, /site-substrate/);
  assert.match(pageShell, /site-inner/);
  assert.match(pageShell, /<SiteNav \/>/);
  assert.match(pageShell, /<Footer \/>/);
});

test("the wordmark has an accessible replacement seam instead of embedding a logo asset", () => {
  assert.match(wordmark, /export function Wordmark/);
  assert.match(wordmark, />\s*Solvo<span/);
  assert.match(wordmark, /solvo-wordmark-point/);
  assert.doesNotMatch(wordmark, /<svg\b|<Image\b|<img\b/);
  assert.match(siteNav, /<Wordmark \/>/);
  assert.match(dashboardLayout, /<Wordmark \/>/);
});

test("site mobile menu exposes state, closes on Escape, and restores focus", () => {
  assert.match(siteNav, /aria-expanded=\{open\}/);
  assert.match(siteNav, /aria-controls="site-menu"/);
  assert.match(siteNav, /aria-label=\{open \? "Close menu" : "Open menu"\}/);
  assert.match(siteNav, /event\.key === "Escape"/);
  assert.match(siteNav, /menuButtonRef\.current\?\.focus\(\)/);
});

test("dashboard layout switches from stacked mobile chrome to a desktop sidebar", () => {
  assert.match(dashboardLayout, /flex min-h-screen flex-col md:flex-row/);
  assert.match(dashboardLayout, /md:h-screen md:w-60/);
  assert.match(dashboardLayout, /<DashboardNav sections=\{DASHBOARD_SECTIONS\} \/>/);
  assert.match(dashboardNav, /md:hidden/);
  assert.match(dashboardNav, /md:flex md:flex-1/);
});

test("dashboard menu has accessible disclosure and keyboard behavior", () => {
  assert.match(dashboardNav, /aria-expanded=\{open\}/);
  assert.match(dashboardNav, /aria-controls="dashboard-sections"/);
  assert.match(dashboardNav, /aria-label="Dashboard sections"/);
  assert.match(dashboardNav, /event\.key === "Escape"/);
  assert.match(dashboardNav, /buttonRef\.current\?\.focus\(\)/);
  assert.match(dashboardNav, /onClick=\{\(\) => setOpen\(false\)\}/);
});

test("dashboard active state covers exact and nested routes and is not color-only", () => {
  assert.match(dashboardNav, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(dashboardNav, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(dashboardNav, /active \? "bg-white\/\[0\.06\] text-primary"/);
  assert.match(dashboardNav, /active \? "opacity-100"/);
});

test("global keyboard focus and reduced-motion contracts remain visible", () => {
  assert.match(globals, /:focus-visible\s*\{[\s\S]*outline:/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /transition-duration:\s*0\.01ms !important/);
  assert.match(dashboardNav, /focus-visible:outline-\[#ff6a00\]/);
});
