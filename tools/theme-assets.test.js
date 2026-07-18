'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const THEME_DIR = join(__dirname, '..', 'src', 'assets', 'themes');
const THEME_REGISTRY = join(
  __dirname,
  '..',
  'src',
  'app',
  'core',
  'theme',
  'custom-theme.service.ts',
);
const SHARED_THEME_VARS = join(__dirname, '..', 'src', 'styles', '_css-variables.scss');
const BUTTON_LABEL_PALETTE_WEIGHT = 18;
const FETCH_BEARING_CSS = /(?:@import\b|\b(?:url|src|image|image-set)\s*\()/i;

const themeFiles = readdirSync(THEME_DIR)
  .filter((file) => file.endsWith('.css'))
  .sort();

const readTheme = (file) => readFileSync(join(THEME_DIR, file), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const withoutRegistryComments = (source) =>
  withoutComments(source).replace(/^\s*\/\/.*$/gm, ' ');
const decodeCssEscapes = (css) =>
  css.replace(
    /\\([0-9a-fA-F]{1,6})(?:[ \t\n\f]|\r\n?)?|\\(\r\n|[\n\r\f])|\\([\s\S])/g,
    (_match, hex, continuation, literal) => {
      if (continuation !== undefined) return '';
      if (literal !== undefined) return literal;
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff
        ? '�'
        : String.fromCodePoint(codePoint);
    },
  );
const targetsBodyElement = (selectorList) =>
  selectorList.split(',').some((selector) => {
    const normalized = selector.trim();
    return (
      !/:(?:before|after|first-line|first-letter)\b/i.test(normalized) &&
      /^body(?:[.#][\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*$/.test(normalized)
    );
  });

const extractAtRuleBody = (css, startPattern) => {
  const match = startPattern.exec(css);
  if (!match) return undefined;
  const open = css.indexOf('{', match.index + match[0].length);
  if (open < 0) return undefined;
  let depth = 1;
  for (let index = open + 1; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}') depth--;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return undefined;
};

const parseColor = (value) => {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const expanded =
      hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join('') : hex[1];
    return [0, 2, 4].map((offset) =>
      Number.parseInt(expanded.slice(offset, offset + 2), 16),
    );
  }

  const rgb = value
    .trim()
    .match(
      /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i,
    );
  if (!rgb) return undefined;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)];
};

const resolveColorValue = (value, declarations, seen = new Set()) => {
  const variable = value.trim().match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    if (seen.has(variable[1])) return undefined;
    seen.add(variable[1]);
    const declaration = declarations.get(variable[1]);
    return declaration ? resolveColorValue(declaration, declarations, seen) : undefined;
  }

  const literal = parseColor(value);
  if (literal) return literal;

  const component = String.raw`(var\(--[\w-]+\)|#[\da-f]{3,6}|rgba?\([^)]+\))`;
  const mix = value
    .trim()
    .match(
      new RegExp(
        `^color-mix\\(\\s*in\\s+srgb\\s*,\\s*${component}\\s+([\\d.]+)%\\s*,\\s*${component}(?:\\s+([\\d.]+)%)?\\s*\\)$`,
        'i',
      ),
    );
  if (!mix) return undefined;

  const left = resolveColorValue(mix[1], declarations, new Set(seen));
  const right = resolveColorValue(mix[3], declarations, new Set(seen));
  if (!left || !right) return undefined;
  const leftWeight = Number(mix[2]);
  const rightWeight = mix[4] === undefined ? 100 - leftWeight : Number(mix[4]);
  const totalWeight = leftWeight + rightWeight;
  return [0, 1, 2, 3].map(
    (channel) =>
      ((left[channel] ?? 1) * leftWeight + (right[channel] ?? 1) * rightWeight) /
      totalWeight,
  );
};

const resolveColor = (name, declarations) => {
  const value = declarations.get(name);
  return value ? resolveColorValue(value, declarations, new Set([name])) : undefined;
};

const relativeLuminance = ([red, green, blue]) => {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (foreground, background) => {
  const alpha = foreground[3] ?? 1;
  const composite = foreground
    .slice(0, 3)
    .map((channel, index) =>
      Math.round(channel * alpha + background[index] * (1 - alpha)),
    );
  const lighter = Math.max(relativeLuminance(composite), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(composite), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

const mixOpaqueColors = (accent, ink, accentWeight) => [
  ...[0, 1, 2].map(
    (channel) => accent[channel] * accentWeight + ink[channel] * (1 - accentWeight),
  ),
  1,
];

test('every built-in theme asset is registered exactly once', () => {
  const registry = withoutRegistryComments(readFileSync(THEME_REGISTRY, 'utf8'));
  const registeredFiles = [...registry.matchAll(/url:\s*'assets\/themes\/([^']+\.css)'/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(registeredFiles, themeFiles);
  assert.equal(new Set(registeredFiles).size, registeredFiles.length);

  const listStart = registry.indexOf('export const BUILT_IN_THEMES');
  const listEnd = registry.indexOf('];', listStart);
  const registryList = registry.slice(listStart, listEnd);
  const registeredIds = [...registryList.matchAll(/\bid:\s*'([^']+)'/g)].map(
    (match) => match[1],
  );
  const expectedIds = [
    'default',
    ...themeFiles.map((file) => file.replace(/\.css$/, '')),
  ].sort();

  assert.deepEqual(registeredIds.sort(), expectedIds);
  assert.equal(new Set(registeredIds).size, registeredIds.length);
});

test('built-in themes declare the minimum public token contract on body rules', () => {
  const requiredTokens = ['--surface-1', '--surface-2', '--ink', '--ink-on-channel'];

  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    const bodyDeclarations = new Set();
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!targetsBodyElement(block[1])) continue;
      for (const declaration of block[2].matchAll(/(--[\w-]+)\s*:/g)) {
        bodyDeclarations.add(declaration[1]);
      }
    }
    for (const token of requiredTokens) {
      assert.ok(bodyDeclarations.has(token), `${file} is missing body-scoped ${token}`);
    }
  }
});

test('body contract selector matching excludes lookalikes and pseudo-elements', () => {
  assert.equal(targetsBodyElement('body'), true);
  assert.equal(targetsBodyElement('body.isDarkTheme'), true);
  for (const selector of [
    '.body',
    'body .child',
    'body::before',
    'body:before',
    'body:after',
    'body:first-line',
    'body:first-letter',
  ]) {
    assert.equal(targetsBodyElement(selector), false, selector);
  }
});

test('consumed Material palette foreground pairs are local and contrast-safe', () => {
  const consumedShades = {
    primary: new Set(['300', '400', '500', '600', '800']),
    accent: new Set(['500']),
  };

  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = new Map(
        [...block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
          match[1],
          match[2].trim(),
        ]),
      );
      for (const palette of ['primary', 'accent']) {
        for (const [name] of declarations) {
          const shade = name.match(
            new RegExp(`^--palette-${palette}-(?!contrast-)([A]?[0-9]+)$`),
          );
          if (!shade || !consumedShades[palette].has(shade[1])) continue;
          const foregroundName = `--palette-${palette}-contrast-${shade[1]}`;
          assert.ok(
            declarations.has(foregroundName),
            `${file} ${block[1].trim()} owns consumed ${name} without ${foregroundName}`,
          );
          const background = resolveColor(name, declarations);
          const foreground = resolveColor(foregroundName, declarations);
          assert.ok(
            background && foreground,
            `${file} ${block[1].trim()} cannot resolve ${name} and ${foregroundName}`,
          );
          const ratio = contrastRatio(foreground, background);
          assert.ok(
            ratio >= 4.5,
            `${file} ${block[1].trim()} ${palette} ${shade[1]} contrast is ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
  }
});

test('resolvable muted text meets normal-text contrast on theme surfaces', () => {
  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\bbody\b/.test(block[1])) continue;
      const declarations = new Map(
        [...block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
          match[1],
          match[2].trim(),
        ]),
      );
      if (!declarations.has('--text-color-muted')) continue;
      const foreground = resolveColor('--text-color-muted', declarations);
      const background = resolveColor('--surface-2', declarations);
      if (!foreground || !background) continue;
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${file} ${block[1].trim()} muted text contrast is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('role-colored button labels stay contrast-safe for arbitrary palette extremes', () => {
  const sharedVars = readFileSync(SHARED_THEME_VARS, 'utf8');
  for (const role of ['primary', 'accent', 'warn']) {
    assert.match(
      sharedVars,
      new RegExp(
        `--button-${role}-label:\\s*color-mix\\(\\s*in\\s+srgb\\s*,\\s*var\\(--palette-${role}-500\\)\\s+${BUTTON_LABEL_PALETTE_WEIGHT}%\\s*,\\s*var\\(--ink-strong\\)\\s*\\)`,
        'i',
      ),
      `${role} button labels must use the guarded palette weight`,
    );
  }

  const paletteExtremes = [
    [0, 0, 0, 1],
    [255, 255, 255, 1],
  ];
  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    let checkedModes = 0;
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\bbody\b/.test(block[1])) continue;
      const declarations = new Map(
        [...block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
          match[1],
          match[2].trim(),
        ]),
      );
      const background = resolveColor('--surface-2', declarations);
      const ink =
        resolveColor('--ink-strong', declarations) ??
        (/(?:^|[\s,])body\.isDarkTheme\b/.test(block[1])
          ? [255, 255, 255, 1]
          : [0, 0, 0, 1]);
      if (!background || !ink) continue;
      checkedModes++;
      for (const palette of paletteExtremes) {
        const label = mixOpaqueColors(palette, ink, BUTTON_LABEL_PALETTE_WEIGHT / 100);
        const ratio = contrastRatio(label, background);
        assert.ok(
          ratio >= 4.5,
          `${file} ${block[1].trim()} worst-case button label contrast is ${ratio.toFixed(2)}:1`,
        );
      }
    }
    assert.ok(checkedModes > 0, `${file} has no resolvable body palette for buttons`);
  }
});

test('Everforest light text and status accents meet normal-text contrast', () => {
  const css = withoutComments(readTheme('everforest.css'));
  const lightBlock = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((block) =>
    /body:not\(\.isDarkTheme\)/.test(block[1]),
  );
  assert.ok(lightBlock, 'Everforest needs a light-mode declaration block');
  const declarations = new Map(
    [...lightBlock[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
  const background = resolveColor('--surface-2', declarations);
  assert.ok(background, 'Everforest light surface must resolve');
  for (const name of [
    '--c-accent',
    '--c-success',
    '--c-warning',
    '--c-error',
    '--c-info',
  ]) {
    const foreground = resolveColor(name, declarations);
    assert.ok(foreground, `Everforest light ${name} must resolve`);
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `Everforest light ${name} must meet 4.5:1 on --surface-2`,
    );
  }
});

test('dark-theme link tokens without underlines meet normal-text contrast', () => {
  const cases = [
    { file: 'arc.css', tokens: ['--arc-link'] },
    {
      file: 'nord-polar-night.css',
      tokens: ['--nord-link', '--nord-link-hover'],
    },
  ];
  for (const { file, tokens } of cases) {
    const css = withoutComments(readTheme(file));
    const darkBlock = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((block) =>
      /(?:^|[\s,])body\.isDarkTheme\b/.test(block[1]),
    );
    assert.ok(darkBlock, `${file} needs a dark body declaration block`);
    const declarations = new Map(
      [...darkBlock[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
        match[1],
        match[2].trim(),
      ]),
    );
    const background = resolveColor('--surface-2', declarations);
    assert.ok(background, `${file} dark surface must resolve`);
    for (const token of tokens) {
      const foreground = resolveColor(token, declarations);
      assert.ok(foreground, `${file} ${token} must resolve`);
      const ratio = contrastRatio(foreground, background);
      assert.ok(ratio >= 4.5, `${file} ${token} contrast is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('built-in themes are standalone upload templates', () => {
  for (const file of themeFiles) {
    const css = decodeCssEscapes(readTheme(file));
    assert.doesNotMatch(
      css,
      FETCH_BEARING_CSS,
      `${file} must not contain a fetch-bearing CSS construct`,
    );
  }
});

test('standalone construct scanning decodes CSS escape spellings', () => {
  for (const css of [
    String.raw`u\72l(https://evil.example/x)`,
    String.raw`@\69mport "https://evil.example/x.css"`,
    String.raw`im\61ge("https://evil.example/x")`,
  ]) {
    assert.match(decodeCssEscapes(css), FETCH_BEARING_CSS);
  }
});

test('built-in themes do not target retired task host classes', () => {
  for (const file of themeFiles) {
    assert.doesNotMatch(
      withoutComments(readTheme(file)),
      /\.(?:sub-)?task-c\b/,
      `${file} targets a retired task host class`,
    );
  }
});

test('themes with glass effects provide solid accessibility and compatibility modes', () => {
  const fallbackMarkers = {
    'glass.css': [/--glass-wallpaper-filter:\s*none/, /--glass-pane:\s*var\(/],
    'liquid-glass.css': [/--card-bg:\s*#/, /--lg-overlay-bg:\s*#/],
    'rainbow.css': [/--neon-blur:\s*none/, /--neon-pane:\s*#/],
    'velvet.css': [/--velvet-frost:\s*none/, /--velvet-pane-1:\s*var\(/],
  };

  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    if (!/backdrop-filter\s*:\s*(?!none)/i.test(css)) continue;
    const reduced = extractAtRuleBody(
      css,
      /@media\s*\(prefers-reduced-transparency:\s*reduce\)/i,
    );
    const unsupported = extractAtRuleBody(css, /@supports\s+not\s*\(backdrop-filter:/i);
    assert.ok(reduced, `${file} needs a reduced-transparency fallback`);
    assert.ok(unsupported, `${file} needs a no-backdrop-filter fallback`);
    assert.ok(fallbackMarkers[file], `${file} needs explicit fallback assertions`);
    for (const marker of fallbackMarkers[file]) {
      assert.match(reduced, marker, `${file} reduced mode is not solid`);
      assert.match(unsupported, marker, `${file} unsupported mode is not solid`);
    }
  }
});

test('task rows avoid per-item backdrop filtering', () => {
  for (const file of themeFiles) {
    const css = withoutComments(readTheme(file));
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1];
      const targetsTaskHost = /(?:^|[\s>+~,])task(?=[.#:[\s>+~,]|$)/.test(selector);
      if (!targetsTaskHost) continue;
      assert.doesNotMatch(
        block[2],
        /backdrop-filter\s*:/i,
        `${file} filters a hot-path task row via ${selector.trim()}`,
      );
    }
  }
});

test('Glass avoids universal resets and per-row compositor effects', () => {
  const glass = withoutComments(readTheme('glass.css'));
  assert.doesNotMatch(glass, /blur\(64px\)/);
  assert.doesNotMatch(glass, /\*\s*\{[^}]*box-shadow:\s*none/is);
});

test('shadowless themes disable effective shared elevation tokens', () => {
  const tokens = [
    '--task-shadow',
    '--task-shadow-sub-task',
    '--card-shadow',
    '--banner-shadow',
    '--bottom-nav-shadow',
    '--whiteframe-shadow-1dp',
    '--whiteframe-shadow-2dp',
    '--whiteframe-shadow-3dp',
    '--whiteframe-shadow-4dp',
    '--whiteframe-shadow-6dp',
    '--whiteframe-shadow-8dp',
    '--whiteframe-shadow-12dp',
    '--whiteframe-shadow-24dp',
  ];
  for (const file of ['dark-base.css', 'dracula.css', 'nord-snow-storm.css']) {
    const css = withoutComments(readTheme(file));
    for (const token of tokens) {
      assert.match(css, new RegExp(`${token}:\\s*none\\s*;`), `${file} needs ${token}`);
    }
  }
});

test('Liquid Glass keeps routed overlays and mobile safe-area math intact', () => {
  const liquidGlass = withoutComments(readTheme('liquid-glass.css'));
  for (const block of liquidGlass.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.main-content(?=[.#:[\s>+~,]|$)/.test(block[1])) continue;
    assert.doesNotMatch(
      block[2],
      /(?:backdrop-filter|filter|transform|contain|will-change)\s*:/i,
      `Liquid Glass must not create a containing block via ${block[1].trim()}`,
    );
  }
  assert.match(
    liquidGlass,
    /--bottom-nav-extra-offset:\s*var\(--s\)\s*;/,
    'Liquid Glass should add only its visual inset; shared nav code owns the safe area',
  );
});

test('deep task hover and running indicators do not override stronger states', () => {
  for (const file of ['rainbow.css', 'velvet.css']) {
    const css = withoutComments(readTheme(file));
    assert.match(
      css,
      /task:not\(\.isSelected\):not\(\.isCurrent\):hover:not\(:has\(task:hover\)\)/,
      `${file} hover must exclude selected and current tasks`,
    );
    assert.match(
      css,
      /task\.isCurrent\s+done-toggle\.is-current:not\(\.is-done\)\s+\.done-toggle-svg/,
      `${file} running halo must target the rendered icon`,
    );
    assert.doesNotMatch(css, /done-toggle(?::|::)(?:before|after)/);
  }
});

test('Velvet task hosts use their component focus border without a second outline', () => {
  const css = withoutComments(readTheme('velvet.css'));
  assert.match(css, /task-detail-item:focus-visible/);
  assert.match(css, /task-detail-item:focus/);
  assert.match(css, /task:focus-visible/);
  assert.match(css, /task:focus/);
  assert.match(css, /task-detail-item:focus\s+\.input-item/);
  assert.doesNotMatch(
    css,
    /task-detail-item\s+\.(?:input-item|mat-expansion-panel):focus-visible/,
  );
});
