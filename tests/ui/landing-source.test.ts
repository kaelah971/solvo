import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landing = readFileSync("src/app/page.tsx", "utf8");
const executionStrip = readFileSync("src/components/ExecutionStrip.tsx", "utf8");
const lamp = readFileSync("src/components/Lamp.tsx", "utf8");
const ghostWordmark = readFileSync("src/components/GhostWordmark.tsx", "utf8");
const wordmark = readFileSync("src/components/Wordmark.tsx", "utf8");
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
  assert.match(landing, /<Wordmark\b/);
  assert.match(landing, /Telegram payment coordination with KeeperHub-backed proof\./);
  assert.match(landing, /<h1\s+className=["']sr-only["']>Solvo<\/h1>/);
  assert.doesNotMatch(landingHero, /<h1(?![^>]*\bsr-only\b)[^>]*>[\s\S]*From instruction[\s\S]*<\/h1>/);
  assert.doesNotMatch(landing, /See the execution path/);
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

test("landing lamp uses the approved raster pendant instead of the old hero SVG", () => {
  const lampJsx = returnedJsx(lamp, "Lamp");

  assert.match(lampJsx, /<(?:Image|img)\b[\s\S]*?src=\{?["']\/images\/solvo-pendant-lamp-v3\.png["']/);
  assert.doesNotMatch(lampJsx, /<svg\b/);
});

test("visible Wordmark resolves to the enlarged, widely tracked muted gray treatment", () => {
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

test("ghost wordmark keeps the separated muted SOLVO lettering", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const ghostCss = classRulesUsedBy(ghostJsx).join("\n");

  assert.match(ghostJsx, />\s*SOLVO\s*</);
  assert.ok(
    hasEmAtLeast(ghostJsx, "tracking", 0.24) || hasEmAtLeast(ghostCss, "letter-spacing", 0.24),
    "expected GhostWordmark's returned JSX or its applied CSS hook to supply at least 0.24em letter spacing",
  );
  assert.ok(
    [...resolvedColorsUsedBy(ghostJsx), ...resolvedColorsUsedBy(ghostCss)].some((color) =>
      approvedGhostColors.has(color) || /^rgba\(237,237,237,0\.05\)$/.test(color),
    ),
    "expected GhostWordmark's returned JSX or applied CSS hook to resolve to an approved muted, faint, ghost, or charcoal color token",
  );
});

test("GhostWordmark grows by about eight percent and rests in muted charcoal", () => {
  const ghostJsx = returnedJsx(ghostWordmark, "GhostWordmark");
  const ghostStyles = stylesUsedBy(ghostJsx);
  const clamp = /clamp\(\s*([0-9.]+)rem\s*,\s*([0-9.]+)vw\s*,\s*([0-9.]+)rem\s*\)/.exec(ghostStyles);
  const scale = /transform\s*:\s*scale\(\s*([0-9.]+)\s*\)/.exec(ghostStyles);
  const hasEightPercentGrowth = clamp
    ? [3.125, 6.25, 6.5].every((baseline, index) => {
      const ratio = Number(clamp[index + 1]) / baseline;
      return ratio >= 1.06 && ratio <= 1.1;
    })
    : scale ? Number(scale[1]) >= 1.06 && Number(scale[1]) <= 1.1 : false;
  const failures = [
    hasEightPercentGrowth ? "" : "expected GhostWordmark to be approximately 8% larger than clamp(3.125rem, 6.25vw, 6.5rem)",
    hasEmAtLeast(ghostStyles, "tracking", 0.24) || hasEmAtLeast(ghostStyles, "letter-spacing", 0.24)
      ? ""
      : "expected GhostWordmark to retain separated letter spacing",
    resolvedColorsUsedBy(ghostStyles).some((color) => isMutedGray(color))
      ? ""
      : "expected GhostWordmark's resting color to resolve to an opaque muted charcoal rather than white",
  ].filter(Boolean);

  assert.equal(failures.length, 0, failures.join("; "));
});

test("GhostWordmark has an eight-second compositor-only left-to-right illumination sweep", () => {
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

test("reduced motion disables both GhostWordmark sweep and lamp breathing", () => {
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
