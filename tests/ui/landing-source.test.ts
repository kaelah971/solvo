import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const landing = readFileSync("src/app/page.tsx", "utf8");
const executionStrip = readFileSync("src/components/ExecutionStrip.tsx", "utf8");
const lamp = readFileSync("src/components/Lamp.tsx", "utf8");
const ghostWordmark = readFileSync("src/components/GhostWordmark.tsx", "utf8");
const wordmark = readFileSync("src/components/Wordmark.tsx", "utf8");
const heroTypingWordmarkPath = "src/components/HeroTypingWordmark.tsx";
const heroTypingWordmark = existsSync(heroTypingWordmarkPath) ? readFileSync(heroTypingWordmarkPath, "utf8") : "";
const globals = readFileSync("src/app/globals.css", "utf8");
const design = readFileSync("DESIGN.md", "utf8");
const landingHero = landing.match(/<section\b[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";

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

const classNamesUsedBy = (jsx: string) => Array.from(
    jsx.matchAll(/className\s*=\s*(?:["']([^"']+)["']|\{`([^`]*)`\}|\{\s*["']([^"']+)["']\s*\})/g),
    (match) => [match[1], match[2], match[3]].find(Boolean) ?? "",
  ).flatMap((className) => className.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []);

const cssRules = (cssSource: string) => Array.from(
  withoutComments(cssSource).matchAll(/(?:^|})\s*([^@}{][^{]*)\{([^{}]*)\}/g),
  (match) => ({ selector: match[1].trim(), body: match[2] }),
);

const cssRulesUsedBy = (jsx: string, cssSource = globals) =>
  classNamesUsedBy(jsx).flatMap((className) => {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Array.from(
      withoutComments(cssSource).matchAll(new RegExp(`([^{}]*\\.${escaped}(?![A-Za-z0-9-])[^{}]*)\\{([^{}]*)\\}`, "g")),
      (match) => ({ selector: match[1].trim(), body: match[2] }),
    );
  });

const classRulesUsedBy = (jsx: string, cssSource = globals) =>
  cssRulesUsedBy(jsx, cssSource).map((rule) => rule.body);

const stylesUsedBy = (jsx: string, cssSource = globals) =>
  `${jsx}\n${classRulesUsedBy(jsx, cssSource).join("\n")}`;

const hasEmAtLeast = (source: string, property: "tracking" | "letter-spacing", minimum: number) => {
  const patterns = property === "tracking"
    ? [/tracking-\[([0-9]*\.?[0-9]+)em\]/g, /letterSpacing\s*:\s*["']?([0-9]*\.?[0-9]+)em/g]
    : [/letter-spacing\s*:\s*([0-9]*\.?[0-9]+)em/g];

  return patterns.some((pattern) =>
    Array.from(source.matchAll(pattern), (match) => Number(match[1])).some((value) => value >= minimum),
  );
};

const normaliseColor = (value: string) => value.replace(/\s+/g, "").toLowerCase();

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
  return normaliseColor(resolved);
};

const approvedGhostColors = new Set([
  ...Array.from(
    design.matchAll(/(?:textMuted|textFaint|textGhost):\s*["']([^"']+)["']/g),
    (match) => normaliseColor(match[1]),
  ),
  ...Array.from(
    globals.matchAll(/--color-(?:ghost|muted|faint|charcoal)\s*:\s*([^;]+);/g),
    (match) => normaliseColor(match[1]),
  ),
]);

const resolvedColor = (value: string) => resolveCssVariables(value);

const resolvedColorsUsedBy = (source: string) => {
  const tailwindTokens = Array.from(source.matchAll(/\btext-([a-z][a-z-]*)\b/g), (match) => `var(--color-${match[1]})`)
    .filter((value) => rootVariables.has(value.slice(4, -1)));
  const arbitraryColors = Array.from(source.matchAll(/\btext-\[([^\]]+)\]/g), (match) => match[1]);
  const cssColors = Array.from(source.matchAll(/\bcolor\s*:\s*([^;\n}]+)/g), (match) => match[1].trim());

  return [...tailwindTokens, ...arbitraryColors, ...cssColors].map(resolvedColor);
};

const hasPxWithin = (source: string, minimum: number, maximum: number) =>
  [/text-\[([0-9]*\.?[0-9]+)px\]/g, /fontSize\s*:\s*["']?([0-9]*\.?[0-9]+)(?:px)?/g, /font-size\s*:\s*([0-9]*\.?[0-9]+)px/g]
    .some((pattern) =>
      Array.from(source.matchAll(pattern), (match) => Number(match[1]))
        .some((value) => value >= minimum && value <= maximum),
    );

const hasMediumWeight = (source: string) =>
  /\bfont-medium\b|\bfont-\[500\]\b|font(?:Weight|-weight)\s*:\s*["']?5\d{2}/.test(source);

const hasRegularOrLightWeight = (source: string) =>
  /\bfont-(?:thin|extralight|light|normal)\b|\bfont-\[(?:[1-4]00)\]\b|font(?:Weight|-weight)\s*:\s*["']?[1-4]\d{2}/.test(source);

const rgbFromColor = (value: string) => {
  const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  }

  const rgb = value.match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : undefined;
};

const isMutedGray = (color: string, { minimum = 80, maximum = 180 } = {}) => {
  const rgb = rgbFromColor(color);
  if (!rgb || (rgb[3] !== undefined && rgb[3] < 1)) return false;
  const [red, green, blue] = rgb;
  return Math.max(red, green, blue) - Math.min(red, green, blue) <= 12
    && red >= minimum && green >= minimum && blue >= minimum
    && red <= maximum && green <= maximum && blue <= maximum;
};

const opacityValuesIn = (source: string) => {
  const resolved = resolveCssVariables(source);
  const cssValues = Array.from(
    resolved.matchAll(/\bopacity\s*:\s*([0-9]*\.?[0-9]+)%?/gi),
    (match) => match[0].includes("%") ? Number(match[1]) / 100 : Number(match[1]),
  );
  const arbitraryUtilities = Array.from(
    resolved.matchAll(/\bopacity-\[([0-9]*\.?[0-9]+)%?\]/gi),
    (match) => match[0].includes("%") ? Number(match[1]) / 100 : Number(match[1]),
  );
  const scaleUtilities = Array.from(
    resolved.matchAll(/\bopacity-(\d{1,3})\b/gi),
    (match) => Number(match[1]) / 100,
  );
  return [...cssValues, ...arbitraryUtilities, ...scaleUtilities];
};

const keyframeBody = (name: string) => {
  const clean = withoutComments(globals);
  const match = new RegExp(`@keyframes\\s+${name}\\s*\\{`, "i").exec(clean);
  if (!match) return "";

  let depth = 1;
  let cursor = (match.index ?? 0) + match[0].length;
  const start = cursor;
  for (; cursor < clean.length && depth > 0; cursor += 1) {
    if (clean[cursor] === "{") depth += 1;
    if (clean[cursor] === "}") depth -= 1;
  }
  return depth === 0 ? clean.slice(start, cursor - 1) : "";
};

const reducedMotionBlock = () => {
  const clean = withoutComments(globals);
  const match = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/.exec(clean);
  if (!match) return "";

  let depth = 1;
  let cursor = (match.index ?? 0) + match[0].length;
  const start = cursor;
  for (; cursor < clean.length && depth > 0; cursor += 1) {
    if (clean[cursor] === "{") depth += 1;
    if (clean[cursor] === "}") depth -= 1;
  }
  return depth === 0 ? clean.slice(start, cursor - 1) : "";
};

const openingTags = (jsx: string) => jsx.match(/<[A-Za-z][^>]*>/g) ?? [];

const simpleStringConstants = (source: string) => new Map(
  Array.from(
    withoutComments(source).matchAll(/\bconst\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=;]+)?\s*=\s*([^;]+);/g),
    (match) => [match[1], match[2].trim()],
  ),
);

const resolveStaticString = (expression: string, constants: Map<string, string>, seen = new Set<string>()): string | undefined => {
  const value = expression.trim().replace(/^\((.*)\)$/, "$1").replace(/\s+as\s+const$/, "");
  const quoted = value.match(/^(["'`])([\s\S]*)\1$/);
  if (quoted && !quoted[2].includes("${")) return quoted[2];
  if (/^[A-Za-z_$][\w$]*$/.test(value) && !seen.has(value)) {
    const constant = constants.get(value);
    return constant ? resolveStaticString(constant, constants, new Set([...seen, value])) : undefined;
  }

  const pieces = value.split("+").map((piece) => resolveStaticString(piece, constants, seen));
  return pieces.length > 1 && pieces.every((piece): piece is string => piece !== undefined)
    ? pieces.join("")
    : undefined;
};

const directSolvoTags = (jsx: string, source: string) => {
  const constants = simpleStringConstants(source);
  return Array.from(
    jsx.matchAll(/<([A-Za-z][A-Za-z0-9.]*)\b[^>]*>\s*(SOLVO|\{([^{}]+)\})\s*<\/\1>/g),
    (match) => ({
      tag: match[0].match(/^<[A-Za-z][^>]*>/)?.[0] ?? "",
      text: match[2] === "SOLVO" ? "SOLVO" : resolveStaticString(match[3], constants),
    }),
  ).filter(({ tag, text }) => Boolean(tag) && text === "SOLVO").map(({ tag }) => tag);
};

const classesInTag = (tag: string) =>
  classNamesUsedBy(tag).filter((className) => !["className", "class"].includes(className));

const animationDeclarations = (jsx: string, cssSource = globals) =>
  cssRulesUsedBy(jsx, cssSource).flatMap((rule) =>
    Array.from(rule.body.matchAll(/\banimation\s*:\s*([^;}]+)(?:;|$)/gi), (match) => ({
      selector: rule.selector,
      declaration: match[1].trim(),
      body: rule.body,
    })),
  );

const animationsWithKeyframes = (jsx: string) => {
  const names = Array.from(withoutComments(globals).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g), (match) => match[1]);
  return animationDeclarations(jsx).flatMap((animation) => names
    .filter((name) => new RegExp(`\\b${name}\\b`, "i").test(animation.declaration))
    .map((name) => ({ ...animation, name })));
};

const animationDurationMs = (declaration: string) => {
  const duration = declaration.match(/(?:^|\s)(\d*\.?\d+)(ms|s)(?:\s|$)/i);
  return duration ? Number(duration[1]) * (duration[2].toLowerCase() === "s" ? 1000 : 1) : undefined;
};

const activeSweepAnimation = (jsx: string) => {
  const keyframeNames = Array.from(withoutComments(globals).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g), (match) => match[1]);
  return animationDeclarations(jsx).flatMap((animation) =>
    keyframeNames
      .filter((name) => new RegExp(`\\b${name}\\b`, "i").test(animation.declaration))
      .map((name) => ({ ...animation, name })),
  )[0];
};

const referencedKeyframes = (source: string) => {
  const declarations = Array.from(
    withoutComments(source).matchAll(/\banimation(?:-name)?\s*:\s*([^;}]+)(?:;|$)/gi),
    (match) => match[1],
  );
  const keyframeNames = Array.from(
    withoutComments(globals).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/gi),
    (match) => match[1],
  );

  return keyframeNames.filter((name) =>
    declarations.some((declaration) => new RegExp(`\\b${name}\\b`, "i").test(declaration)),
  );
};

const animatedPropertiesIn = (source: string) =>
  Array.from(source.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/gi), (match) => match[1].toLowerCase());

const isForbiddenBaseAnimationProperty = (property: string) =>
  /^(?:transform|translate|rotate|scale|position|top|right|bottom|left|inset(?:-.+)?|letter-spacing|filter|backdrop-filter|width|height|min-width|max-width|min-height|max-height|margin(?:-.+)?|padding(?:-.+)?|display|float|clear|overflow(?:-.+)?|grid(?:-.+)?|grid-area|gap|row-gap|column-gap|flex(?:-.+)?|order|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self)|font-size|line-height)$/i.test(property);

test("landing uses the Solvo wordmark and approved hero copy", () => {
  assert.match(withoutComments(landingHero), /<HeroTypingWordmark\b/);
  assert.match(landing, /Telegram payment coordination with KeeperHub-backed proof\./);
  assert.match(landing, /<h1\s+className=["']sr-only["']>Solvo<\/h1>/);
  assert.doesNotMatch(landingHero, /<h1(?![^>]*\bsr-only\b)[^>]*>[\s\S]*From instruction[\s\S]*<\/h1>/);
  assert.doesNotMatch(landing, /See the execution path/);
});

test("hero places one outline Telegram action directly beneath its descriptor without a configuration note", () => {
  const activeHero = withoutComments(landingHero);
  const heroTelegram = activeHero.match(
    /Telegram payment coordination with KeeperHub-backed proof\.\s*<\/p>[\s\S]*?<TelegramCta\b[^>]*\/>/,
  )?.[0] ?? "";
  const cta = heroTelegram.match(/<TelegramCta\b[^>]*\/>/)?.[0] ?? "";
  const failures = [
    heroTelegram ? "" : "expected the hero Telegram CTA after the descriptor",
    /label=["']Open Solvo in Telegram["']/.test(cta) ? "" : "expected the hero CTA label to be explicit",
    /variant=["']outline["']/.test(cta) ? "" : "expected the restrained outline treatment",
    /showConfigurationNote=\{false\}/.test(cta) ? "" : "expected no hero configuration note",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("landing renders exactly two hidden decorative hero arrows", () => {
  const openingTags = landing.match(/<[A-Za-z][^>]*>/g) ?? [];
  const heroArrows = openingTags.filter((tag) =>
    /className=["'][^"']*\bhero-arrow\b[^"']*["']/.test(tag),
  );

  assert.equal(heroArrows.length, 2);
  for (const heroArrow of heroArrows) {
    assert.match(heroArrow, /aria-hidden=["']true["']/);
  }
});

test("landing renders one execution strip", () => {
  const executionStrips = landing.match(/<ExecutionStrip\b/g) ?? [];

  assert.equal(executionStrips.length, 1);
});

test("execution strip defines the approved three-step flow", () => {
  for (const copy of [
    "01",
    "Check",
    "Validate addresses, amounts and limits.",
    "02",
    "Execute",
    "Simulate and submit through KeeperHub.",
    "03",
    "Prove",
    "Return the hash and audit record.",
  ]) {
    assert.ok(executionStrip.includes(copy), `expected ExecutionStrip to contain: ${copy}`);
  }
});

test("execution strip steps are real anchors to the existing check, execution, and proof sections", () => {
  const sectionIds = new Set(
    Array.from(withoutComments(landing).matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/g), (match) => match[1]),
  );
  const expectedTargets = ["#check", "#execution-line", "#prove"];
  const stripJsx = returnedJsx(executionStrip, "ExecutionStrip");
  const linkTag = openingTags(stripJsx).find((tag) => /<(?:a|Link)\b/i.test(tag) && /href=\{item\.href\}/.test(tag)) ?? "";
  const failures = [
    linkTag ? "" : "expected each rendered strip item to use its item.href as a real anchor",
    ...expectedTargets.map((target) =>
      new RegExp(`href\\s*:\\s*["']${target.replace("#", "\\#")}["']`).test(executionStrip)
        ? ""
        : `expected strip item target ${target}`,
    ),
    ...expectedTargets.map((target) =>
      sectionIds.has(target.slice(1)) ? "" : `expected landing section ${target} to exist`,
    ),
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("execution strip anchors reveal a restrained top hairline and emphasize number and title on hover or focus", () => {
  const stripJsx = returnedJsx(executionStrip, "ExecutionStrip");
  const linkTag = openingTags(stripJsx).find((tag) => /\bexecution-strip-link\b/.test(tag)) ?? "";
  const numberTag = openingTags(stripJsx).find((tag) => /\bexecution-strip-number\b/.test(tag)) ?? "";
  const titleTag = openingTags(stripJsx).find((tag) => /\bexecution-strip-title\b/.test(tag)) ?? "";
  const rules = cssRulesUsedBy(`${linkTag}\n${numberTag}\n${titleTag}`);
  const source = rules.map((rule) => `${rule.selector} { ${rule.body} }`).join("\n");
  const baseHairline = rules.find((rule) =>
    /\.execution-strip-link::(?:before|after)/.test(rule.selector)
      && /(?:height|block-size)\s*:\s*1px|border-top\s*:\s*1px/i.test(rule.body),
  );
  const revealRules = rules.filter((rule) =>
    /\.execution-strip-link:(?:hover|focus-visible)/.test(rule.selector)
      && /::(?:before|after)/.test(rule.selector),
  );
  const failures = [
    linkTag ? "" : "expected execution-strip-link hook on every step anchor",
    numberTag ? "" : "expected execution-strip-number hook",
    titleTag ? "" : "expected execution-strip-title hook",
    baseHairline ? "" : "expected a one-pixel top hairline owned by the step link",
    revealRules.some((rule) => /transform\s*:\s*scaleX\(\s*1\s*\)|opacity\s*:\s*1/i.test(rule.body))
      ? ""
      : "expected the top hairline to reveal on hover or focus",
    /\.execution-strip-link:hover[\s\S]*\.execution-strip-(?:number|title)|\.execution-strip-link:focus-visible[\s\S]*\.execution-strip-(?:number|title)/i.test(source)
      && /color\s*:\s*(?:var\(--color-primary\)|#ededed)/i.test(source)
      ? ""
      : "expected hover/focus to emphasize the step number and title",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("landing lamp uses the approved raster pendant instead of the old hero SVG", () => {
  const lampJsx = returnedJsx(lamp, "Lamp");
  const lampTag = landingHero.match(/<Lamp\b[^>]*\/>/)?.[0] ?? "";
  const lampWrapper = openingTags(landingHero).find((tag) => /\bhero-lamp\b/.test(tag)) ?? "";
  const lampGeometry = stylesUsedBy(lampWrapper);

  assert.match(lampJsx, /<(?:Image|img)\b[\s\S]*?src=\{?["']\/images\/solvo-pendant-lamp-v3\.png["']/);
  assert.doesNotMatch(lampJsx, /<svg\b/);
  assert.match(lampJsx, /width=\{1024\}/);
  assert.match(lampJsx, /height=\{1536\}/);
  assert.match(lampJsx, /sizes=["']\(max-height: 500px\) and \(min-width: 640px\) 168px, \(max-width: 640px\) 250px, max\(270px, min\(24vw, 360px\)\)["']/);
  assert.match(lampTag, /className=["']lamp-breathe block h-auto w-full["']/);
  assert.match(lampGeometry, /top\s*:\s*0/);
  assert.match(lampGeometry, /left\s*:\s*50%/);
  assert.match(lampGeometry, /width\s*:\s*clamp\(270px,\s*24vw,\s*360px\)/);
  assert.match(lampGeometry, /transform\s*:\s*translateX\(-50%\)/);
});

test("a stationary bounded lamp-light treatment illuminates the center letters without changing lamp geometry", () => {
  const typingJsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const raysTag = openingTags(typingJsx).find((tag) => /\bhero-lamp-rays\b/.test(tag)) ?? "";
  const litWordTag = directSolvoTags(typingJsx, heroTypingWordmark)
    .find((tag) => /\bhero-lamp-lit-wordmark\b/.test(tag)) ?? "";
  const rayRules = cssRulesUsedBy(raysTag);
  const rayStyles = stylesUsedBy(raysTag);
  const litStyles = stylesUsedBy(litWordTag);
  const lockupTag = openingTags(landingHero).find((tag) => /\bhero-wordmark-lockup\b/.test(tag)) ?? "";
  const lockupStyles = stylesUsedBy(lockupTag);
  const centered = /(?:left|inset-inline-start)\s*:\s*50%/i.test(rayStyles)
    && /translateX\(\s*-50%\s*\)/i.test(rayStyles);
  const bounded = /(?:width|inline-size|max-width)\s*:/i.test(rayStyles)
    && /(?:height|block-size|max-height)\s*:/i.test(rayStyles);
  const clippedToStage = /overflow\s*:\s*hidden|clip-path\s*:|(?:-webkit-)?mask-image\s*:/i.test(`${rayStyles}\n${lockupStyles}`);
  const lightIsGlyphClipped = /(?:-webkit-)?background-clip\s*:\s*text/i.test(litStyles)
    && /(?:-webkit-)?text-fill-color\s*:\s*transparent|color\s*:\s*transparent/i.test(litStyles);
  const failures = [
    raysTag && /aria-hidden=["']true["']/.test(raysTag) ? "" : "expected an aria-hidden hero-lamp-rays layer",
    /position\s*:\s*absolute|\babsolute\b/i.test(rayStyles) ? "" : "expected rays removed from document flow",
    centered ? "" : "expected rays centered directly under the unchanged lamp",
    bounded && clippedToStage ? "" : "expected the ray field to be dimensionally bounded and clipped to the wordmark stage",
    rayRules.some((rule) => /(?:linear|radial)-gradient\(/i.test(rule.body)) ? "" : "expected a soft gradient ray field",
    litWordTag && lightIsGlyphClipped ? "" : "expected a static duplicate SOLVO light layer clipped to the letter shapes",
    animationDeclarations(raysTag).length === 0 && animationDeclarations(litWordTag).length === 0
      ? ""
      : "expected the lamp rays and letter illumination to remain stationary",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("shared Wordmark remains the enlarged, widely tracked muted gray treatment", () => {
  const markJsx = returnedJsx(wordmark, "Wordmark");
  const markStyles = stylesUsedBy(markJsx);
  const failures = [
    hasPxWithin(markStyles, 12, 14) ? "" : "expected Wordmark to resolve to 12–14px type",
    hasEmAtLeast(markStyles, "tracking", 0.44) || hasEmAtLeast(markStyles, "letter-spacing", 0.44)
      ? ""
      : "expected Wordmark to resolve to at least 0.44em letter spacing",
    hasMediumWeight(markStyles) ? "" : "expected Wordmark to use medium (500–599) weight",
    resolvedColorsUsedBy(markStyles).some((color) => isMutedGray(color, { minimum: 130, maximum: 180 }))
      ? ""
      : "expected Wordmark to resolve to a muted gray near #9a9ca0 rather than primary white",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("GhostWordmark exposes the complete static small SOLVO sub-word", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const ghostStyles = stylesUsedBy(ghostJsx);

  assert.match(ghostJsx, />\s*SOLVO\s*</);
  assert.ok(
    hasPxWithin(ghostStyles, 12, 14),
    "expected GhostWordmark to resolve to 12–14px sub-word type",
  );
  assert.ok(
    hasEmAtLeast(ghostStyles, "tracking", 0.35) || hasEmAtLeast(ghostStyles, "letter-spacing", 0.35),
    "expected GhostWordmark to retain generous sub-word letter spacing",
  );
});

test("GhostWordmark remains fully visible and owns no animation or cursor hooks", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const ghostStyles = stylesUsedBy(ghostJsx);
  const colors = resolvedColorsUsedBy(ghostStyles).map(rgbFromColor).filter(Boolean);
  const failures = [
    colors.some((color) => color![0] >= 220 && color![1] >= 220 && color![2] >= 220 && (color![3] ?? 1) === 1)
      ? ""
      : "expected the sub-word to resolve to fully opaque near-white",
    !/(?:mask-image|-webkit-mask-image|clip-path)\s*:/i.test(ghostStyles)
      ? ""
      : "expected the sub-word to remain fully visible",
    animationDeclarations(ghostJsx).length === 0 ? "" : "expected no sub-word animation",
    !/hero-typing-(?:wordmark|measure|cursor)/i.test(ghostJsx) ? "" : "expected no typing or cursor hooks on the sub-word",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test.skip("obsolete illumination sweep contract", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const ghostStyles = stylesUsedBy(ghostJsx);
  const sweepAnimation = activeSweepAnimation(ghostJsx);
  const sweep = sweepAnimation ? keyframeBody(sweepAnimation.name) : "";
  const solvoTags = directSolvoTags(ghostJsx, ghostWordmark);
  const sweepClasses = sweepAnimation
    ? Array.from(sweepAnimation.selector.matchAll(/\.([A-Za-z][A-Za-z0-9-]*)/g), (match) => match[1])
    : [];
  const pseudoOverlay = /::(?:before|after)\b/i.test(sweepAnimation?.selector ?? "")
    && /content\s*:\s*["']SOLVO["']/i.test(sweepAnimation?.body ?? "");
  const overlayTag = pseudoOverlay
    ? solvoTags[0] ?? ""
    : solvoTags.find((tag) =>
      /aria-hidden\s*=\s*["']true["']/.test(tag)
        && sweepClasses.some((className) => classesInTag(tag).includes(className)),
    ) ?? "";
  const baseTag = pseudoOverlay
    ? solvoTags[0] ?? ""
    : solvoTags.find((tag) => tag !== overlayTag) ?? "";
  const baseClasses = classesInTag(baseTag);
  const overlayStyles = pseudoOverlay
    ? cssRulesUsedBy(baseTag).filter((rule) => /::(?:before|after)\b/i.test(rule.selector)).map((rule) => rule.body).join("\n")
    : stylesUsedBy(overlayTag);
  const decorativeOverlay = Boolean(sweepAnimation) && Boolean(overlayTag) && (
    pseudoOverlay
      ? /aria-hidden\s*=\s*["']true["']/.test(overlayTag)
      : /aria-hidden\s*=\s*["']true["']/.test(overlayTag) && solvoTags.includes(overlayTag)
  );
  const distinctSweepHook = Boolean(sweepAnimation) && (
    pseudoOverlay || sweepClasses.some((className) => !baseClasses.includes(className))
  );
  const alignedOverlay = Boolean(sweepAnimation) && (
    /(?:\babsolute\b|position\s*:\s*absolute)/i.test(`${overlayTag}\n${overlayStyles}`)
      && /(?:\binset-0\b|\binset\s*:\s*0|\btop\s*:\s*0[;\s\S]*?\bleft\s*:\s*0)/i.test(`${overlayTag}\n${overlayStyles}`)
  );
  const glyphClippedOverlay = (
    /(?:-webkit-)?background-clip\s*:\s*text/i.test(overlayStyles)
      && /(?:-webkit-)?text-fill-color\s*:\s*transparent|\bcolor\s*:\s*transparent/i.test(overlayStyles)
  ) || /(?:-webkit-)?mask(?:-image)?\s*:/i.test(overlayStyles);
  const baseRules = cssRulesUsedBy(baseTag).filter((rule) => {
    const targetCompounds = rule.selector.split(",").map((selector) =>
      selector.trim().split(/\s+|(?=[>+~])|(?<=[>+~])/).filter(Boolean).at(-1) ?? "",
    );
    return targetCompounds.some((target) => {
      const selectorClasses = Array.from(target.matchAll(/\.([A-Za-z][A-Za-z0-9-]*)/g), (match) => match[1]);
      return !/::/.test(target) && selectorClasses.length > 0 && selectorClasses.every((className) => baseClasses.includes(className));
    });
  });
  const baseHasDirectTransform = baseRules.some((rule) => /\btransform\s*:/i.test(rule.body));
  const forbiddenBaseAnimationProperties = baseRules.flatMap((rule) =>
    referencedKeyframes(rule.body).flatMap((name) => animatedPropertiesIn(keyframeBody(name))),
  ).filter(isForbiddenBaseAnimationProperty);
  const animatedProperties = animatedPropertiesIn(sweep);
  const leftToRight = /transform\s*:\s*translate(?:x|3d)?\(\s*-\d/i.test(sweep)
    && /transform\s*:\s*translate(?:x|3d)?\(\s*(?!-)\d/i.test(sweep);
  const failures = [
    sweepAnimation ? "" : "expected an active GhostWordmark CSS-hook animation that names a declared keyframe",
    /(?:\b8s\b|\b8000ms\b)/i.test(sweepAnimation?.declaration ?? "")
      ? ""
      : "expected that active sweep declaration itself to specify 8s or 8000ms",
    /\binfinite\b/i.test(sweepAnimation?.declaration ?? "")
      ? ""
      : "expected that active sweep declaration itself to specify infinite repetition",
    baseTag ? "" : "expected an actual text-bearing base element with literal SOLVO",
    !baseHasDirectTransform && forbiddenBaseAnimationProperties.length === 0
      ? ""
      : `expected the literal SOLVO base target to have no direct transform or animation keyframes that animate transform, position, scale, tracking, layout, or filter (found: ${forbiddenBaseAnimationProperties.join(", ")})`,
    decorativeOverlay ? "" : "expected an aria-hidden duplicate-SOLVO overlay or pseudo-element with content: 'SOLVO'",
    distinctSweepHook ? "" : "expected the overlay to use a distinct sweep hook rather than the base text hook",
    alignedOverlay ? "" : "expected the decorative sweep overlay to be absolutely aligned over the GhostWordmark",
    glyphClippedOverlay ? "" : "expected the GhostWordmark sweep to use text glyph clipping or a text mask, not ordinary overflow clipping",
    leftToRight ? "" : "expected sweep keyframes to move a highlight from negative to positive translateX/translate3d",
    /opacity\s*:/i.test(sweep) ? "" : "expected sweep keyframes to animate opacity",
    animatedProperties.every((property) => ["transform", "opacity", "animation-timing-function"].includes(property))
      ? ""
      : `expected sweep keyframes to avoid layout, filter, and letter-spacing animation (found: ${animatedProperties.join(", ")})`,
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test.skip("obsolete reduced-motion sweep contract", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const reduced = reducedMotionBlock();
  const sweepAnimation = activeSweepAnimation(ghostJsx);
  const reducedSweepRules = sweepAnimation
    ? cssRules(reduced).filter((rule) => rule.selector.includes(sweepAnimation.selector.replace(/::(?:before|after)\b/i, "")))
    : [];
  const reducedSweepStyles = reducedSweepRules.map((rule) => rule.body).join("\n");
  const failures = [
    reduced ? "" : "expected a prefers-reduced-motion: reduce media block",
    /\.lamp-breathe\b[\s\S]*?animation(?:-name)?\s*:\s*none\b/i.test(reduced)
      ? ""
      : "expected reduced motion to suppress lamp breathing",
    sweepAnimation && /animation(?:-name)?\s*:\s*none\b|animation-play-state\s*:\s*paused\b/i.test(reducedSweepStyles)
      ? ""
      : "expected reduced motion to suppress the active GhostWordmark sweep hook",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("hero composes a fixed main typing word with a centered static sub-word below", () => {
  const activeHero = withoutComments(landingHero);
  const lockup = openingTags(activeHero).find((tag) => /\bhero-wordmark-lockup\b/.test(tag)) ?? "";
  const subWord = activeHero.match(/<GhostWordmark\b[^>]*\/>/)?.[0] ?? "";
  const failures = [
    lockup ? "" : "expected hero-wordmark-lockup",
    /<HeroTypingWordmark\b[\s\S]*<GhostWordmark\b/.test(activeHero) ? "" : "expected the animated main word before the static sub-word",
    /(?:\brelative\b|position\s*:\s*relative|\bgrid\b|display\s*:\s*grid)/i.test(stylesUsedBy(lockup)) ? "" : "expected shared positioning context",
    !/(?:\babsolute\b|position\s*:\s*absolute|\b-translate-x-|transform\s*:)/i.test(stylesUsedBy(subWord)) ? "" : "expected the static sub-word to remain centered below without absolute shifting",
  ].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("small sub-SOLVO is fully visible, static, widely spaced, and near-white", () => {
  const jsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const base = directSolvoTags(jsx, ghostWordmark).find((tag) => /\bghost-wordmark-base\b/.test(tag)) ?? "";
  const styles = stylesUsedBy(base);
  const colors = resolvedColorsUsedBy(styles).map(rgbFromColor).filter(Boolean);
  const failures = [
    base ? "" : "expected literal SOLVO sub-word",
    hasPxWithin(styles, 12, 14) ? "" : "expected the sub-word at 12–14px",
    hasEmAtLeast(styles, "tracking", 0.35) || hasEmAtLeast(styles, "letter-spacing", 0.35) ? "" : "expected generous sub-word tracking",
    colors.some((color) => color![0] >= 220 && color![1] >= 220 && color![2] >= 220 && (color![3] ?? 1) === 1) ? "" : "expected fully visible near-white sub-word",
    !/(?:mask-image|-webkit-mask-image|clip-path)\s*:/i.test(styles) ? "" : "expected the sub-word to remain fully visible without clipping or masking",
    animationDeclarations(base).length === 0 ? "" : "expected the sub-word to remain static",
    !/hero-typing-(?:wordmark|cursor|measure)/i.test(jsx) ? "" : "expected no typing or cursor hooks on the sub-word",
  ].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("oversized main SOLVO reserves its full width and owns the typing hooks", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const styles = stylesUsedBy(jsx);
  const root = openingTags(jsx)[0] ?? "";
  const largeClamp = /(?:font-size\s*:\s*|text-\[)clamp\(\s*([0-9.]+)rem\s*,\s*([0-9.]+)vw\s*,\s*([0-9.]+)rem\s*\)/i.exec(styles);
  const desktopDominant = largeClamp && Number(largeClamp[2]) >= 6.25 && Number(largeClamp[3]) >= 6.5;
  const failures = [/aria-hidden\s*=\s*["']true["']/.test(root) ? "" : "expected decorative main wrapper", directSolvoTags(jsx, heroTypingWordmark).length >= 2 ? "" : "expected measured and animated literal SOLVO", /\bhero-typing-wordmark\b/.test(jsx) && /\bhero-typing-measure\b/.test(jsx) && /\bhero-typing-cursor\b/.test(jsx) ? "" : "expected typing, measurement, and cursor hooks on the main word", /(?:\binline-grid\b|display\s*:\s*(?:inline-)?grid|\brelative\b|position\s*:\s*relative)/i.test(stylesUsedBy(root)) ? "" : "expected fixed footprint", /(?:visibility\s*:\s*hidden|\binvisible\b|color\s*:\s*transparent|opacity\s*:\s*0\b)/i.test(styles) ? "" : "expected hidden full-word measure", desktopDominant ? "" : "expected desktop main SOLVO at least as large as clamp(3.125rem, 6.25vw, 6.5rem)", hasEmAtLeast(styles, "tracking", 0.24) || hasEmAtLeast(styles, "letter-spacing", 0.24) ? "" : "expected widely tracked main lettering"].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("every typing phase retains a complete faint masked SOLVO ghost behind the active letters", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const solvoTags = directSolvoTags(jsx, heroTypingWordmark);
  const ghostTag = solvoTags.find((tag) => /\bhero-typing-ghost\b/.test(tag)) ?? "";
  const typingTag = solvoTags.find((tag) => /\bhero-typing-wordmark\b/.test(tag)) ?? "";
  const ghostStyles = stylesUsedBy(ghostTag);
  const ghostColors = resolvedColorsUsedBy(ghostStyles).map(rgbFromColor).filter(Boolean);
  const faint = opacityValuesIn(ghostStyles).some((value) => value >= 0.04 && value <= 0.15)
    || ghostColors.some((color) => (color![3] ?? 1) >= 0.04 && (color![3] ?? 1) <= 0.15);
  const verticalDissolve = /(?:-webkit-)?mask-image\s*:\s*linear-gradient\(\s*to bottom\b[\s\S]*?transparent\s+(?:6\d|7\d)%/i.test(ghostStyles);
  const sameCell = /\bcol-start-1\b/.test(ghostTag) && /\brow-start-1\b/.test(ghostTag)
    && /\bcol-start-1\b/.test(typingTag) && /\brow-start-1\b/.test(typingTag);
  const absolutelyStacked = /(?:\babsolute\b|position\s*:\s*absolute)/i.test(ghostStyles)
    && /(?:\binset-0\b|inset\s*:\s*0)/i.test(ghostStyles);
  const failures = [
    ghostTag ? "" : "expected a literal full SOLVO with the hero-typing-ghost hook",
    faint ? "" : "expected the complete ghost word to remain within roughly 4â€“15% visibility",
    verticalDissolve ? "" : "expected a top-to-bottom mask that dissolves the ghost near 70%",
    sameCell || absolutelyStacked ? "" : "expected the ghost and typed word to share one centered stack",
    jsx.indexOf(ghostTag) < jsx.indexOf(typingTag) ? "" : "expected the ghost layer behind the active typed layer",
    !/clip-path\s*:/i.test(ghostStyles) ? "" : "expected no typing clip-path on the complete ghost word",
    animationDeclarations(ghostTag).length === 0 ? "" : "expected the ghost word to stay visible and stationary through the full typing loop",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("foreground repeatedly types, holds, deletes, and pauses with approved timing", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const tag = openingTags(jsx).find((candidate) => /\bhero-typing-wordmark\b/.test(candidate)) ?? "";
  const animation = animationsWithKeyframes(tag)[0];
  const frames = animation ? keyframeBody(animation.name) : "";
  const duration = animationDurationMs(animation?.declaration ?? "");
  const entries = Array.from(frames.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({ percentages: Array.from(match[1].matchAll(/([0-9]*\.?[0-9]+)%/g), (p) => Number(p[1])), body: match[2] }));
  const firstTimeFor = (predicate: (body: string) => boolean) => { const p = entries.flatMap((entry) => predicate(entry.body) ? entry.percentages : []).sort((a, b) => a - b)[0]; return p !== undefined && duration !== undefined ? duration * p / 100 : undefined; };
  const typed = firstTimeFor((body) => /clip-path\s*:\s*inset\(\s*0\s+0%/i.test(body));
  const erasePercent = entries.flatMap((entry) =>
    /clip-path\s*:\s*inset\([^)]*calc\(\s*100%\s*-/i.test(entry.body)
      ? entry.percentages
      : [],
  ).filter((percentage) => duration !== undefined && duration * percentage / 100 > 2000)
    .sort((a, b) => a - b)[0];
  const erase = erasePercent !== undefined && duration !== undefined ? duration * erasePercent / 100 : undefined;
  const emptyPercents = entries.flatMap((entry) => /clip-path\s*:\s*inset\(\s*0\s+100%/i.test(entry.body) ? entry.percentages : []).filter((p) => duration !== undefined && duration * p / 100 > 2000);
  const empty = emptyPercents.length && duration !== undefined ? duration * Math.min(...emptyPercents) / 100 : undefined;
  const near = (actual: number | undefined, expected: number) => actual !== undefined && Math.abs(actual - expected) <= 190;
  const failures = [animation ? "" : "expected typing animation", duration !== undefined && duration >= 3100 && duration <= 3500 ? "" : "expected ~3.3s cycle", /\binfinite\b/i.test(animation?.declaration ?? "") ? "" : "expected infinite cycle", near(typed, 700) ? "" : "expected ~0.7s typing", typed !== undefined && erase !== undefined && near(erase - typed, 1400) ? "" : "expected ~1.4s hold", erase !== undefined && empty !== undefined && near(empty - erase, 500) ? "" : "expected ~0.5s erase", empty !== undefined && duration !== undefined && near(duration - empty, 700) ? "" : "expected ~0.7s empty hold"].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("typing reveal uses exact measured glyph boundaries in both directions", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const typingTag = openingTags(jsx).find((candidate) => /\bhero-typing-wordmark\b/.test(candidate)) ?? "";
  const typing = animationsWithKeyframes(typingTag)[0];
  const reveals = Array.from(keyframeBody(typing?.name ?? "").matchAll(/clip-path\s*:\s*inset\([^;{}]*?calc\(\s*100%\s*-\s*([0-9]*\.?[0-9]+)em\s*\)[^;{}]*\)/gi), (match) => Number(match[1]));
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const ru = unique(reveals);
  const expected = [0.947, 2.005, 2.821, 3.768, 4.826];
  const both = (values: number[], all: number[]) => values.length === 5 && values.every((value) => all.filter((entry) => entry === value).length >= 2);
  const exact = ru.length === expected.length && ru.every((value, index) => Math.abs(value - expected[index]) <= 0.001);
  const failures = [
    exact ? "" : `expected exact measured cumulative boundaries ${expected.join(", ")}em`,
    both(ru, reveals) ? "" : "expected every measured boundary during both typing and deleting",
  ].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("typing reveal uses one global step-end timing without keyframe overrides", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const tag = openingTags(jsx).find((candidate) => /\bhero-typing-wordmark\b/.test(candidate)) ?? "";
  const animation = animationsWithKeyframes(tag)[0];
  const frames = animation ? keyframeBody(animation.name) : "";
  const failures = [animation ? "" : "expected typing animation", /(?:step-end|steps\(\s*1\s*,\s*end\s*\))/i.test(animation?.declaration ?? "") ? "" : "expected global step-end", !/animation-timing-function\s*:/i.test(frames) ? "" : "expected no keyframe timing override"].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("completed cursor is anchored to the measured main word edge", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const typingTag = openingTags(jsx).find((candidate) => /\bhero-typing-wordmark\b/.test(candidate)) ?? "";
  const cursorTag = openingTags(jsx).find((candidate) => /\bhero-typing-cursor\b/.test(candidate)) ?? "";
  const typingStyles = stylesUsedBy(typingTag);
  const cursorStyles = stylesUsedBy(cursorTag);
  const cursorAnimations = animationsWithKeyframes(cursorTag);
  const cursorFrames = cursorAnimations
    .filter((animation) => /transform\s*:/i.test(keyframeBody(animation.name)))
    .map((animation) => keyframeBody(animation.name))
    .join("\n");
  const edgeAnchoredCursor = (
    /border-right\s*:/i.test(typingStyles)
      && !/hero-typing-cursor\b/.test(jsx)
  ) || (
    /\.hero-typing-cursor\b/i.test(cursorStyles)
      && /(?:left|inset-inline-start)\s*:\s*(?:100%|var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\))/i.test(cursorStyles)
      && /(?:width|max-width|inline-size)\s*:\s*var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\)/i.test(typingStyles)
  ) || (
    /var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\)/i.test(cursorStyles)
      && /var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\)/i.test(typingStyles)
  );
  const independentlyTranslated = /translateX\(\s*[0-9]*\.?[0-9]+em\s*\)/i.test(cursorFrames);
  const failures = [
    edgeAnchoredCursor
      ? ""
      : "expected the completed cursor to derive from the same measurable word-edge mechanism as the reveal",
    !independentlyTranslated
      ? ""
      : "expected no independently hand-tuned em translate that can exceed the rendered text edge",
  ].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("typing cursor stays on the clipped reveal edge and blinks forever", () => {
  const jsx = returnedJsx(heroTypingWordmark, "HeroTypingWordmark");
  const tag = openingTags(jsx).find((candidate) => /\bhero-typing-cursor\b/.test(candidate)) ?? "";
  const animations = animationsWithKeyframes(tag);
  const blink = animations.find((animation) => /opacity\s*:/i.test(keyframeBody(animation.name)));
  const typingTag = openingTags(jsx).find((candidate) => /\bhero-typing-wordmark\b/.test(candidate)) ?? "";
  const typingStyles = stylesUsedBy(typingTag);
  const cursorStyles = stylesUsedBy(tag);
  const sameEdge = /border-right\s*:/i.test(typingStyles)
    || /(?:left|inset-inline-start)\s*:\s*(?:100%|var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\))/i.test(cursorStyles)
    || (/var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\)/i.test(cursorStyles)
      && /var\(--[A-Za-z0-9-]*(?:word|text|reveal|edge|width)[A-Za-z0-9-]*\)/i.test(typingStyles));
  const transformTrack = animations.some((animation) => /transform\s*:/i.test(keyframeBody(animation.name)));
  const failures = [
    sameEdge ? "" : "expected cursor attached to the same clipped reveal edge",
    blink && /\binfinite\b/i.test(blink.declaration) ? "" : "expected infinite blink",
    !transformTrack ? "" : "expected no independent cursor transform track",
  ].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("reduced motion shows complete main and static sub SOLVO while disabling hero motion", () => {
  const reduced = reducedMotionBlock();
  const typed = cssRules(reduced).filter((rule) => /\.hero-typing-wordmark\b/.test(rule.selector)).map((rule) => rule.body).join("\n");
  const cursor = cssRules(reduced).filter((rule) => /\.hero-typing-cursor\b/.test(rule.selector)).map((rule) => rule.body).join("\n");
  const subJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const failures = [/\.lamp-breathe\b[\s\S]*?animation(?:-name)?\s*:\s*none\b/i.test(reduced) ? "" : "expected stopped lamp", /animation(?:-name)?\s*:\s*none\b/i.test(typed) ? "" : "expected stopped main typing", /clip-path\s*:\s*(?:none|inset\(\s*0(?:%|px)?\s*\))|width\s*:\s*(?:100%|auto)/i.test(typed) ? "" : "expected complete main SOLVO", /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(cursor) ? "" : "expected hidden main cursor", />\s*SOLVO\s*</.test(subJsx) && animationDeclarations(subJsx).length === 0 ? "" : "expected complete static sub-SOLVO under reduced motion"].filter(Boolean);
  assert.equal(failures.length, 0, failures.join("; "));
});

test("reduced motion leaves the lamp at its breathing animation resting opacity", () => {
  const lampTag = landing.match(/<Lamp\b[^>]*\/>/)?.[0] ?? "";
  const lampStyles = stylesUsedBy(`${lampTag}\n${returnedJsx(lamp, "Lamp")}`);
  const endpointBlocks = referencedKeyframes(lampStyles).flatMap((name) =>
    Array.from(keyframeBody(name).matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
      selectors: match[1],
      opacity: opacityValuesIn(match[2]).at(-1),
    })),
  );
  const startOpacity = endpointBlocks.find(({ selectors }) => /(?:^|,)\s*(?:from|0%)\s*(?:,|$)/i.test(selectors))?.opacity;
  const endOpacity = endpointBlocks.find(({ selectors }) => /(?:^|,)\s*(?:to|100%)\s*(?:,|$)/i.test(selectors))?.opacity;
  const reducedLampStyles = cssRules(reducedMotionBlock())
    .filter((rule) => /\.lamp-breathe(?![A-Za-z0-9-])/i.test(rule.selector))
    .map((rule) => rule.body)
    .join("\n");
  const reducedOpacities = opacityValuesIn(reducedLampStyles);
  const staticOpacities = opacityValuesIn(lampStyles);
  const restingOpacity = reducedOpacities.at(-1) ?? staticOpacities.at(-1);
  const endpointIsResting = startOpacity !== undefined && endOpacity !== undefined
    && Math.abs(startOpacity - 0.82) <= 0.02
    && Math.abs(endOpacity - startOpacity) <= 0.01;
  const failures = [
    endpointIsResting
      ? ""
      : "expected lamp-breathe's start and end keyframes to share the approved resting opacity near 0.82",
    restingOpacity !== undefined && endOpacity !== undefined && Math.abs(restingOpacity - endOpacity) <= 0.01
      ? ""
      : "expected the lamp's static or reduced-motion opacity to equal its breathing endpoint near 0.82 rather than defaulting to 1",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});
