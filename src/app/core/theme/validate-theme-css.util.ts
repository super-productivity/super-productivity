import { THEME_CONTRACT, ThemeCssWarning } from './theme-contract.const';

export type { ThemeCssWarning } from './theme-contract.const';

/** Hard cap on theme CSS payloads. Themes ≥ 500 KB almost always indicate
 *  bundled assets we don't support yet, or copy/paste pollution. */
export const MAX_THEME_CSS_SIZE = 500 * 1024;

export interface ThemeCssValidationResult {
  isValid: boolean;
  errors: string[];
  /**
   * Non-blocking warnings — populated only when `errors` is empty (we don't
   * pile warnings on top of an already-rejected payload). Currently only
   * presence checks against `THEME_CONTRACT`; selector-aware checks are a
   * tracked follow-up.
   */
  warnings?: ThemeCssWarning[];
}

/**
 * Inspect a theme CSS payload before installing it. Themes are restricted
 * to declarations that can't reach the network.
 *
 * Rejects:
 *   - any `url(...)` / `@import url(...)` argument that resolves to an
 *     absolute URL (`http:`, `https:`, `//host/...`, schemeless absolute)
 *   - any relative `url(...)` (no bundled assets in v1)
 *   - `data:` URIs (also bundled-asset territory)
 *
 * Accepts: `url(#fragment)` (in-document SVG references) and CSS that
 * contains no `url(` / `@import` at all.
 *
 * The check is intentionally regex-based — pulling in a full CSS parser
 * for one rule is overkill, and false positives bias toward blocking,
 * which is the safe direction for security checks.
 */
export const validateThemeCss = (css: string): ThemeCssValidationResult => {
  const errors: string[] = [];

  if (typeof css !== 'string') {
    return { isValid: false, errors: ['Theme CSS payload is missing'] };
  }

  const byteLength =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(css).length
      : css.length;
  if (byteLength > MAX_THEME_CSS_SIZE) {
    errors.push(
      `Theme CSS is too large (${(byteLength / 1024).toFixed(1)} KB; max ${(
        MAX_THEME_CSS_SIZE / 1024
      ).toFixed(0)} KB)`,
    );
  }

  // Order matters: DECODE first, then STRIP. CSS Syntax §4.3 normalizes hex
  // escapes inside ident-tokens BEFORE keyword/url-token matching. If we
  // strip comments first and then decode, an attacker who escape-encodes the
  // `url` keyword (`u\72l(`) hides the url-token from the URL-aware stripper,
  // letting a `/*` inside the disguised url() open a comment that eats the
  // real `url(http://evil)` later in the file. Decode first → the stripper
  // sees `url(` for what it is and refuses to enter comment-mode inside.
  const decoded = decodeCssEscapes(css);

  // Strip comments. Tracks string-literal AND url-token state so:
  //   - `/*` inside `"..."` / `'...'` stays as string content
  //   - `/*` inside `url(...)` (unquoted arg) stays as url content (per CSS
  //     spec, comments aren't recognized inside a url-token)
  // Replaces each comment with a single SPACE, not nothing — comments are
  // whitespace per the spec, so `@import/**/"..."` must become `@import "..."`
  // for the @import regex (which requires `\s+`) to still match.
  // Rejects unterminated comments outright as malformed CSS.
  const stripResult = stripCssComments(decoded);
  if (!stripResult.ok) {
    errors.push(stripResult.error);
    return { isValid: false, errors };
  }
  const stripped = stripResult.css;

  // Scan for url(<arg>), src(<arg>), and @import "...". Both function forms
  // extract their argument from capture groups 1-3 (quoted ", quoted ', bare).
  // The @import-with-url() form is covered by the url() pass.
  //
  // `src(...)` is the CSS Fonts Module Level 4 form of `@font-face { src: ... }`
  // and is treated by browsers as a fetchable resource — same exfiltration
  // surface as `url(...)`. Bundled fonts are a v1 non-goal so any argument is
  // rejected.
  const scan = (pattern: RegExp, label: string): void => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      const arg = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      const reason = classifyThemeUrl(arg);
      if (reason) {
        errors.push(formatUrlError(label, match[0], reason, stripped, match.index));
      }
    }
  };
  scan(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, 'url(...)');
  scan(/src\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, 'src(...)');
  // `image-set(...)` (CSS Images Module Level 4) takes <image-set-option>#
  // args — each option is `<image> <resolution>?`. The <image> may be a
  // `<string>` (which the browser fetches like a URL), `url(...)`, `src(...)`,
  // a `<gradient>` function, or `image()`. Inner `url(...)` / `src(...)` are
  // already caught above. We extract each comma-separated option, find its
  // leading <image> token (string or bare URL-like word), and classify.
  // Skip options whose leading token looks like a CSS function call (e.g.
  // `linear-gradient(...)`) — those have no fetchable arg of their own.
  const imageSetRegex = /image-set\s*\(/gi;
  let imgSetMatch: RegExpExecArray | null;
  while ((imgSetMatch = imageSetRegex.exec(stripped)) !== null) {
    const argsStart = imgSetMatch.index + imgSetMatch[0].length;
    const argsEnd = findMatchingParen(stripped, argsStart);
    if (argsEnd < 0) continue;
    const argsBody = stripped.slice(argsStart, argsEnd);
    for (const option of splitTopLevel(argsBody, ',')) {
      const token = extractLeadingImageToken(option);
      if (token === null) continue;
      const reason = classifyThemeUrl(token);
      if (reason) {
        errors.push(
          formatUrlError(
            'image-set(...)',
            `image-set(${option.trim()})`,
            reason,
            stripped,
            imgSetMatch.index,
          ),
        );
      }
    }
  }
  scan(/@import\s+(?:"([^"]*)"|'([^']*)')/gi, '@import');

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Presence-only scan against THEME_CONTRACT. Reuses the already-decoded,
  // comment-stripped `stripped` value — no re-decode, no re-strip.
  const warnings = scanThemeContract(stripped);
  return warnings.length > 0
    ? { isValid: true, errors, warnings }
    : { isValid: true, errors };
};

/**
 * Walk `THEME_CONTRACT` and emit a warning for every token that does not
 * appear as a CSS custom-property declaration anywhere in the (already-decoded,
 * comment-stripped) input.
 *
 * Single-pass: one regex enumerates every `--foo:` declaration in the input,
 * then the contract is checked via `Set.has()`. Beats per-token regex compile
 * + scan for large CSS payloads.
 *
 * Strings (`"..."` / `'...'`) and url-token contents (`url(...)`) are blanked
 * out before the scan — without that, `body { content: "--surface-1:" }`
 * would suppress the `--surface-1` warning despite the token never being
 * declared. Comment stripping happens upstream (`stripCssComments` runs
 * before this), but strings stay intact there because the URL classifier
 * needs to see them.
 *
 * Detection is presence-only: it does NOT parse selectors, so a theme that
 * declares `--surface-1` at `:root` (rather than `body` / `body.isDarkTheme`)
 * will pass even though it's mode-inconsistent. Selector-aware validation
 * is a tracked follow-up.
 */
const DECLARATION_PATTERN = /(?:^|[^\w-])(--[\w-]+)\s*:/gm;

export const scanThemeContract = (stripped: string): ThemeCssWarning[] => {
  const scanView = blankStringAndUrlContents(stripped);
  const declared = new Set<string>();
  for (const m of scanView.matchAll(DECLARATION_PATTERN)) {
    declared.add(m[1]);
  }
  const warnings: ThemeCssWarning[] = [];
  for (const spec of THEME_CONTRACT) {
    if (!declared.has(spec.name)) {
      warnings.push({ token: spec.name });
    }
  }
  return warnings;
};

/**
 * Replace string-literal and url-token CONTENTS with spaces, leaving the
 * delimiters (`"`, `'`, `url(`, `)`) and surrounding structure intact.
 *
 * Used by `scanThemeContract` to avoid matching `--token:` sequences that
 * appear inside string values or unquoted url-token args. Length-preserving
 * so any future error reporting can reuse source indices.
 *
 * Operates on already-decoded, comment-stripped CSS. Quotes that close the
 * same kind that opened are honored; backslash-escaped chars inside strings
 * are skipped so `"\""` stays a single string.
 */
const blankStringAndUrlContents = (css: string): string => {
  const out: string[] = [];
  let i = 0;
  let inString: '"' | "'" | null = null;
  let inUrl = false;
  while (i < css.length) {
    const ch = css[i];
    if (inString) {
      if (ch === '\\' && i + 1 < css.length) {
        out.push('  ');
        i += 2;
        continue;
      }
      if (ch === inString) {
        out.push(ch);
        inString = null;
      } else {
        out.push(' ');
      }
      i++;
      continue;
    }
    if (inUrl) {
      if (ch === ')') {
        out.push(ch);
        inUrl = false;
      } else if (ch === '"' || ch === "'") {
        out.push(ch);
        inUrl = false;
        inString = ch;
      } else {
        out.push(' ');
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out.push(ch);
      i++;
      continue;
    }
    if (
      (ch === 'u' || ch === 'U') &&
      i + 3 < css.length &&
      (css[i + 1] === 'r' || css[i + 1] === 'R') &&
      (css[i + 2] === 'l' || css[i + 2] === 'L') &&
      css[i + 3] === '('
    ) {
      out.push(css.slice(i, i + 4));
      i += 4;
      inUrl = true;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
};

type StripCssResult = { ok: true; css: string } | { ok: false; error: string };

/**
 * Strip CSS comments, preserving string literals and url-tokens, replacing
 * each comment with a single space (per CSS spec, comments are whitespace).
 *
 * Two attack classes the naive `replace(/\/\*[\s\S]*?\*\//g, '')` permits:
 *   1. `/*` inside `"..."` / `'...'` — fixed by tracking `inString`.
 *   2. `/*` inside `url(<unquoted>)` — fixed by tracking `inUrl`. Per CSS
 *      Syntax §4.3.6, comments aren't recognized inside a url-token; e.g.
 *      `a{background:url(/*)} b{background:url(http://evil)}` parses as
 *      two URL tokens, not "first url + comment to EOF".
 *   3. `@import/* … *​/"..."` — comments must collapse to whitespace, not
 *      vanish, so the `@import\s+...` regex still fires after stripping.
 *      Replacing each `/* ... *​/` with a single SPACE handles this.
 *
 * Caller decodes CSS escapes BEFORE this runs, so `u\72l(` is already
 * `url(` — keyword detection is a contiguous case-insensitive match.
 *
 * Unterminated `/*` (no closing `*​/`) is malformed CSS and rejected outright
 * — a benign theme will not contain one, and tolerating it lets an attacker
 * hide a remote `url(...)` after the bogus comment-open.
 */
const stripCssComments = (css: string): StripCssResult => {
  let out = '';
  let i = 0;
  let inString: '"' | "'" | null = null;
  let inUrl = false;
  while (i < css.length) {
    const ch = css[i];

    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (inUrl) {
      // Inside an unquoted url-token: pass everything through verbatim until
      // the matching `)`. Strings inside url() switch the token type to
      // function + string, but the conservative thing is to also honor
      // inString tracking inside; we set inUrl=false and let the string
      // branch handle it.
      out += ch;
      if (ch === ')') inUrl = false;
      else if (ch === '"' || ch === "'") {
        // url("...") or url('...') — pretend it's a function call: leave url
        // mode and let inString tracking take over for the quoted arg.
        inUrl = false;
        inString = ch;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i++;
      continue;
    }

    // Detect `url(` (case-insensitive, contiguous — escapes already decoded).
    if (
      (ch === 'u' || ch === 'U') &&
      i + 3 < css.length &&
      (css[i + 1] === 'r' || css[i + 1] === 'R') &&
      (css[i + 2] === 'l' || css[i + 2] === 'L') &&
      css[i + 3] === '('
    ) {
      out += css.slice(i, i + 4);
      i += 4;
      inUrl = true;
      continue;
    }

    if (ch === '/' && css[i + 1] === '*') {
      // Find closing */; reject if unterminated.
      const end = css.indexOf('*/', i + 2);
      if (end < 0) {
        return { ok: false, error: 'Theme CSS has an unterminated /* comment' };
      }
      out += ' '; // comments collapse to a single space, not nothing
      i = end + 2;
      continue;
    }

    out += ch;
    i++;
  }
  return { ok: true, css: out };
};

/**
 * Decode CSS escapes per CSS Syntax §4.3. Two forms:
 *   1. `\<hex 1-6>` optionally followed by a single whitespace — code point.
 *   2. `\<any non-hex single char>` — literal char (newline becomes nothing
 *      when at end of value, but for our scan-for-keywords purpose we keep
 *      the literal char).
 *
 * We deliberately decode *inside string literals too*: an attacker could
 * stash `\3a //evil` (escaped `:`) inside `url("...")` as a quoted bare
 * URL. The browser collapses these escapes before fetching, so we must
 * too.
 */
const decodeCssEscapes = (css: string): string =>
  // Hex form: \<1-6 hex>[ \t\n\r\f]?  →  the corresponding code point.
  // Literal form: \<single char>      →  that char.
  // Trailing `\` at EOF doesn't match either alternation and is left as-is.
  css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g, (_m, hex, lit) => {
    if (lit !== undefined) return lit;
    const cp = parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff ? '�' : String.fromCodePoint(cp);
  });

/**
 * Find the index of the `)` that closes a `(` at position `start - 1`.
 * Honors string literals and nested parens. Returns -1 if unbalanced.
 */
const findMatchingParen = (css: string, start: number): number => {
  let depth = 1;
  let inString: '"' | "'" | null = null;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (inString) {
      if (ch === '\\' && i + 1 < css.length) {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Split a string by `sep` at depth 0 only — string literals and parenthesized
 * groups are kept intact. Used to walk the comma-separated args of
 * `image-set(...)` without splitting `linear-gradient(red, blue)`.
 */
const splitTopLevel = (input: string, sep: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let last = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (ch === '\\' && i + 1 < input.length) {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(input.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(input.slice(last));
  return parts;
};

/**
 * Extract the leading <image> token from a single image-set option:
 *   "https://..." 1x         → "https://..."  (quoted string)
 *   https://... 1x            → "https://..." (bare URL-like token)
 *   linear-gradient(red, blue) 1x → null      (function call, skip)
 *   url(...) / src(...)       → null (inner scans handled it)
 *   image-set(...)            → null (let the outer loop handle the nested one)
 *
 * Returns the token to classify, or null if the option should be skipped.
 */
const extractLeadingImageToken = (option: string): string | null => {
  const trimmed = option.trim();
  if (!trimmed) return null;
  const first = trimmed[0];
  if (first === '"' || first === "'") {
    // Quoted string — extract its content.
    let i = 1;
    while (i < trimmed.length && trimmed[i] !== first) {
      if (trimmed[i] === '\\' && i + 1 < trimmed.length) i += 2;
      else i++;
    }
    return trimmed.slice(1, i);
  }
  // Bare token: read up to whitespace or `(` to spot function calls.
  let i = 0;
  while (i < trimmed.length && !/[\s(]/.test(trimmed[i])) i++;
  // Hit a `(` — it's a function call (gradient, url, src, image-set, etc.).
  // Inner url/src scans cover the dangerous ones; skip here.
  if (i < trimmed.length && trimmed[i] === '(') return null;
  return trimmed.slice(0, i);
};

type UrlRejectReason = 'remote' | 'data' | 'relative';

const classifyThemeUrl = (arg: string): UrlRejectReason | null => {
  if (!arg) return 'relative';
  // In-document fragment (`#gradient` for inline SVG) — harmless.
  if (arg.startsWith('#')) return null;
  if (/^https?:/i.test(arg)) return 'remote';
  if (arg.startsWith('//')) return 'remote';
  if (/^data:/i.test(arg)) return 'data';
  // Any other scheme (file:, ftp:, blob:, javascript:) — reject as remote-equivalent.
  if (/^[a-z][a-z0-9+.-]*:/i.test(arg)) return 'remote';
  // Anything else is a relative path / bundled-asset reference.
  return 'relative';
};

const formatUrlError = (
  kind: string,
  raw: string,
  reason: UrlRejectReason,
  source: string,
  index: number,
): string => {
  const line = source.slice(0, index).split('\n').length;
  let why: string;
  switch (reason) {
    case 'remote':
      why = 'remote URLs are blocked in theme CSS';
      break;
    case 'data':
      why = 'data: URIs are not allowed in theme CSS';
      break;
    case 'relative':
      why = 'bundled assets are not supported in theme CSS (v1)';
      break;
  }
  return `Line ${line}: ${kind} ${raw.trim()} — ${why}`;
};
