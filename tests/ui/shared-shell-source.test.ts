import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageShell = readFileSync("src/components/PageShell.tsx", "utf8");
const landing = readFileSync("src/app/page.tsx", "utf8");
const siteNav = readFileSync("src/components/SiteNav.tsx", "utf8");
const telegramCta = readFileSync("src/components/TelegramCta.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");

const returnedJsx = (source: string, component: string) => {
  const clean = withoutComments(source);
  const componentBody = clean.match(
    new RegExp(`export\\s+(?:default\\s+)?function\\s+${component}\\b[\\s\\S]*?\\n}`),
  )?.[0] ?? "";

  const functionJsx = componentBody.match(/return\s*\(\s*([\s\S]*?)\s*\);\s*}$/)?.[1];
  const constComponent = clean.match(
    new RegExp(`export\\s+const\\s+${component}\\b[\\s\\S]*?=>\\s*\\(\\s*([\\s\\S]*?)\\s*\\);`),
  )?.[1];
  const jsx = functionJsx ?? constComponent ?? "";
  const helperNames = Array.from(
    jsx.matchAll(/<(?:[A-Z][A-Za-z0-9]*\.)?([A-Z][A-Za-z0-9]*)\b|\{\s*([a-z][A-Za-z0-9]*)\s*\(/g),
    (match) => match[1] ?? match[2],
  );
  const helperJsx = helperNames.flatMap((helper) => {
    const helperBody = clean.match(
      new RegExp(`(?:function\\s+|const\\s+)${helper}\\b[\\s\\S]*?\\n}`),
    )?.[0] ?? "";
    return helperBody.match(/return\s*\(\s*([\s\S]*?)\s*\);\s*}$/)?.[1] ?? [];
  });
  return [jsx, ...helperJsx].join("\n");
};

const classRulesUsedBy = (jsx: string) => {
  const classes = Array.from(
    jsx.matchAll(/className\s*=\s*(?:["']([^"']+)["']|\{`([^`]*)`\}|\{\s*["']([^"']+)["']\s*\})/g),
    (match) => [match[1], match[2], match[3]].find(Boolean) ?? "",
  ).flatMap((className) => className.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []);

  return classes.flatMap((className) => {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Array.from(globals.matchAll(new RegExp(`\\.${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g")), (match) => match[1]);
  });
};

const hasPxAtLeast = (source: string, minimum: number) =>
  [/text-\[([0-9]*\.?[0-9]+)px\]/g, /fontSize\s*:\s*["']?([0-9]*\.?[0-9]+)(?:px)?/g, /font-size\s*:\s*([0-9]*\.?[0-9]+)px/g]
    .some((pattern) =>
      Array.from(source.matchAll(pattern), (match) => Number(match[1])).some((value) => value >= minimum),
    );

const siteSubstrateRule = () =>
  withoutComments(globals).match(/\.site-substrate\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

const cssRules = (cssSource: string) => Array.from(
  withoutComments(cssSource).matchAll(/(?:^|})\s*([^@}{][^{]*)\{([^{}]*)\}/g),
  (match) => ({ selector: match[1].trim(), body: match[2] }),
);

const cssFunctionBodies = (source: string, functionName: string) => {
  const clean = withoutComments(source);
  const bodies: string[] = [];
  const pattern = new RegExp(`${functionName}\\s*\\(`, "gi");
  for (const match of clean.matchAll(pattern)) {
    let depth = 1;
    let cursor = (match.index ?? 0) + match[0].length;
    const start = cursor;
    for (; cursor < clean.length && depth > 0; cursor += 1) {
      if (clean[cursor] === "(") depth += 1;
      if (clean[cursor] === ")") depth -= 1;
    }
    if (depth === 0) bodies.push(clean.slice(start, cursor - 1));
  }
  return bodies;
};

const splitCssArguments = (source: string) => {
  const arguments_: string[] = [];
  let depth = 0;
  let start = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] === "(") depth += 1;
    if (source[cursor] === ")") depth -= 1;
    if (source[cursor] === "," && depth === 0) {
      arguments_.push(source.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  arguments_.push(source.slice(start).trim());
  return arguments_;
};

const rootVariables = new Map(
  Array.from(
    withoutComments(globals).match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]?.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g) ?? [],
    (match) => [match[1], match[2].trim()],
  ),
);

const resolveCssVariables = (value: string) => {
  let resolved = value;
  for (let depth = 0; depth < 8; depth += 1) {
    const next = resolved.replace(/var\((--[A-Za-z0-9-]+)(?:,[^)]+)?\)/g, (full, name) => rootVariables.get(name) ?? full);
    if (next === resolved) break;
    resolved = next;
  }
  return resolved;
};

const rgbColorsIn = (value: string) => {
  const hexes = Array.from(value.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi), (match) => {
    const hex = match[1].length === 3 ? [...match[1]].map((part) => part + part).join("") : match[1];
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  });
  const rgbs = Array.from(value.matchAll(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/gi), (match) =>
    [Number(match[1]), Number(match[2]), Number(match[3])],
  );
  return [...hexes, ...rgbs];
};

const isWithin = (rgb: number[], minimum: number[], maximum: number[]) =>
  rgb.every((channel, index) => channel >= minimum[index] && channel <= maximum[index]);

test("page shell uses the shared substrate structure", () => {
  assert.match(pageShell, /site-substrate/);
  assert.match(pageShell, /site-inner/);
  assert.doesNotMatch(pageShell, /main-plane/);
});

test("active landing wrapper uses the shared site substrate", () => {
  const homeJsx = returnedJsx(landing, "Home");
  const openingWrapper = homeJsx.match(/^\s*<div\b[^>]*>/)?.[0] ?? "";

  assert.match(openingWrapper, /className\s*=\s*["'`{][^>]*\bsite-substrate\b/);
});

test("site substrate resolves to a continuous charcoal hero without a black landing plane", () => {
  const substrate = resolveCssVariables(siteSubstrateRule());
  const colors = rgbColorsIn(substrate);
  const failures = [
    /(?:radial|linear|conic)-gradient\(/i.test(substrate)
      ? ""
      : "expected .site-substrate to provide one continuous CSS gradient field",
    colors.some((rgb) => isWithin(rgb, [40, 43, 47], [48, 51, 56]))
      ? ""
      : "expected .site-substrate's brightest hero color in the #282b2f–#303338 range",
    colors.some((rgb) => isWithin(rgb, [21, 23, 26], [27, 29, 32]))
      ? ""
      : "expected .site-substrate's edge color in the #15171a–#1b1d20 range",
    /\bblack\b|#(?:000|000000)\b|rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*[,)]|$)/i.test(substrate)
      ? "expected .site-substrate to avoid a black landing plane"
      : "",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("site substrate geometry centers the hero glow in the viewport and reaches the edge tone", () => {
  const activeGradientRules = cssRules(globals).filter((rule) =>
    /\.(?:site-substrate|landing-hero)(?![A-Za-z0-9-])/i.test(rule.selector)
      && /radial-gradient\s*\(/i.test(rule.body),
  );
  const candidates = activeGradientRules.flatMap((rule) =>
    cssFunctionBodies(resolveCssVariables(rule.body), "radial-gradient").map((gradient) => ({
      selector: rule.selector,
      rule: resolveCssVariables(rule.body),
      gradient,
      arguments: splitCssArguments(gradient),
    })),
  );
  const validGeometry = candidates.find(({ selector, arguments: [geometry = ""] }) => {
    const viewport = geometry.match(
      /(?:ellipse\s+)?([0-9.]+)vw\s+([0-9.]+)vh\s+at\s+([0-9.]+)(%|vw)\s+([0-9.]+)vh/i,
    );
    if (viewport) {
      const [, radiusX, radiusY, centerX, , centerY] = viewport.map(Number);
      return radiusX >= 65 && radiusX <= 100
        && radiusY >= 45 && radiusY <= 75
        && centerX >= 45 && centerX <= 55
        && centerY >= 20 && centerY <= 36;
    }

    const heroScoped = /\.landing-hero(?![A-Za-z0-9-])/i.test(selector) && geometry.match(
      /(?:ellipse\s+)?([0-9.]+)%\s+([0-9.]+)%\s+at\s+([0-9.]+)%\s+([0-9.]+)%/i,
    );
    if (!heroScoped) return false;
    const [, radiusX, radiusY, centerX, centerY] = heroScoped.map(Number);
    return radiusX >= 65 && radiusX <= 100
      && radiusY >= 45 && radiusY <= 75
      && centerX >= 45 && centerX <= 55
      && centerY >= 20 && centerY <= 36;
  });
  const edgeColor = /#17191c\b|rgba?\(\s*23\s*,\s*25\s*,\s*28(?:\s*[,)]|$)/i;
  const validEdge = candidates.some(({ rule, arguments: stops }) => {
    const edgeBackground = /background-color\s*:\s*(?:#17191c\b|rgba?\(\s*23\s*,\s*25\s*,\s*28(?:\s*[,)]|$))|background\s*:\s*(?:#17191c\b|rgba?\(\s*23\s*,\s*25\s*,\s*28(?:\s*[,)]|$))/i.test(rule);
    return stops.slice(1).some((stop) => {
      const stopPosition = Number(stop.match(/([0-9.]+)%\s*$/)?.[1]);
      return stopPosition >= 60 && stopPosition <= 70
        && (edgeColor.test(stop) || (edgeBackground && /\btransparent\b/i.test(stop)));
    });
  });
  const failures = [
    validGeometry
      ? ""
      : "expected a hero-centered radial field with viewport-relative vw/vh radii at about 50% 28vh, or equivalent geometry on a hero-scoped layer",
    validEdge
      ? ""
      : "expected the radial field to resolve to #17191c at an approximately 60–70% edge stop rather than a 140% stop",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("desktop primary navigation uses the approved labels", () => {
  const primaryLinks = siteNav.match(/const primaryLinks[\s\S]*?(?=const menuLinks)/)?.[0];

  assert.ok(primaryLinks, "expected a primaryLinks block before menuLinks");
  assert.match(primaryLinks, /Product/);
  assert.match(primaryLinks, /How it works/);
  assert.doesNotMatch(primaryLinks, /Security/);
});

test("site navigation renders the text Telegram CTA and accessible menu state", () => {
  assert.match(siteNav, /<TelegramCta\b[\s\S]*?variant=["']text["']/);
  assert.match(siteNav, /aria-expanded=\{open\}/);
  assert.match(siteNav, /aria-controls=["']site-menu["']/);
});

test("home mark keeps its accessible label and enlarged type size", () => {
  const navJsx = returnedJsx(siteNav, "SiteNav");
  const homeMark = navJsx.match(/<Link\b[\s\S]*?aria-label=["']Solvo home["'][\s\S]*?<\/Link>/)?.[0] ?? "";
  const homeMarkCss = classRulesUsedBy(homeMark).join("\n");

  assert.match(homeMark, /aria-label=["']Solvo home["']/);
  assert.ok(
    hasPxAtLeast(homeMark, 14) || hasPxAtLeast(homeMarkCss, 14),
    "expected the home mark's returned JSX or applied CSS hook to provide a font size of at least 14px",
  );
});

test("mobile navigation closes on Escape and returns focus", () => {
  assert.match(siteNav, /event\.key\s*===\s*["']Escape["']/);
  assert.match(siteNav, /setOpen\(false\)/);
  assert.match(siteNav, /menuButtonRef\.current\?\.focus\(\)/);
});

test("Telegram CTA keeps the specified optional props", () => {
  assert.match(telegramCta, /variant\?:\s*["']outline["']\s*\|\s*["']text["']/);
  assert.match(telegramCta, /showConfigurationNote\?:\s*boolean/);
});
