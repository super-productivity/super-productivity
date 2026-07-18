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
 *   - every `@import` rule (installed themes are standalone)
 *   - any `url(...)` argument that resolves to an
 *     absolute URL (`http:`, `https:`, `//host/...`, schemeless absolute)
 *   - any relative `url(...)` (no bundled assets in v1)
 *   - `data:` URIs (also bundled-asset territory)
 *   - every `image(...)` and `image-set(...)` function
 *
 * Accepts: `url(#fragment)` (in-document SVG references) and CSS that
 * contains no network-capable or advanced image functions.
 *
 * The check is intentionally regex-based — pulling in a full CSS parser for
 * this narrow, conservative allowlist is overkill, and false positives bias
 * toward blocking, which is the safe direction for security checks.
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
    return { isValid: false, errors };
  }

  // Validate real comment delimiters on the provenance-preserving source.
  // Escape decoding can create quote characters that would otherwise make a
  // raw unterminated comment look like string content.
  const rawCommentResult = stripCssComments(css, true);
  if (!rawCommentResult.ok) {
    errors.push(rawCommentResult.error);
    return { isValid: false, errors };
  }

  // Decode once. The `url(` / `src(` security scans intentionally inspect this
  // UNSTRIPPED view: decoding can create quote or comment-delimiter characters
  // that were escaped identifiers in the source, so relying on the decoded
  // text's apparent string/comment structure could let a disguised token hide
  // a later live fetch. The keyword-presence bans (`@import`, `image()`,
  // `image-set()`) instead scan the comment-stripped view below — they have no
  // fetchable argument to classify, so exempting genuine comments is safe.
  const decoded = decodeCssEscapes(css);

  // Strip comments for malformed-comment detection, the keyword-presence bans,
  // and the later theme-contract scan. Tracks string-literal AND url-token
  // state so:
  //   - `/*` inside `"..."` / `'...'` stays as string content
  //   - `/*` inside `url(...)` (unquoted arg) stays as url content (per CSS
  //     spec, comments aren't recognized inside a url-token)
  // Replaces each comment with a single SPACE, not nothing — comments are
  // whitespace per the spec, keeping token boundaries intact for warnings.
  // Rejects unterminated comments outright as malformed CSS.
  const stripResult = stripCssComments(decoded);
  if (!stripResult.ok) {
    errors.push(stripResult.error);
    return { isValid: false, errors };
  }
  const stripped = stripResult.css;

  // Installed themes are standalone, so even an apparently local/fragment
  // import is invalid. `@import` is a keyword-presence ban with no fetchable
  // argument to classify, so scan the comment-stripped view: a real `@import`
  // survives (comments only collapse to whitespace), while the same text in a
  // `/* ... */` comment is correctly exempt. Strings stay intact through the
  // stripper, so `content: "@import"` is still rejected on the safe side —
  // blanking strings here is unsafe (an escape-created quote could hide a
  // later real at-rule), so we don't.
  const importMatch = /@import\b/i.exec(stripped);
  if (importMatch) {
    const line = stripped.slice(0, importMatch.index).split('\n').length;
    errors.push(`Line ${line}: @import is not supported in theme CSS`);
    return { isValid: false, errors };
  }

  // Scan for url(<arg>) and src(<arg>). Both function forms
  // extract their argument from capture groups 1-3 (quoted ", quoted ', bare).
  // `src(...)` is the CSS Fonts Module Level 4 form of `@font-face { src: ... }`
  // and is treated by browsers as a fetchable resource — same exfiltration
  // surface as `url(...)`. Bundled fonts are a v1 non-goal so any argument is
  // rejected.
  const scan = (pattern: RegExp, label: string): void => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(decoded)) !== null) {
      const arg = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      const reason = classifyThemeUrl(arg);
      if (reason) {
        errors.push(formatUrlError(label, match[0], reason, decoded, match.index));
      }
    }
  };
  scan(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, 'url(...)');
  scan(/src\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, 'src(...)');

  // A `url(` / `src(` with no closing `)` before end-of-input still yields a
  // fetchable url-token: CSS Syntax §4.3.6 emits the token when consuming
  // reaches EOF, so `background:url(http://evil` (file ends mid-url) fetches
  // on every load. The argument regexes above require the `)` and miss it, so
  // reject any opener that runs unterminated to end-of-input.
  const unterminatedUrl = /(?:url|src)\s*\([^)]*$/i.exec(decoded);
  if (unterminatedUrl) {
    const line = decoded.slice(0, unterminatedUrl.index).split('\n').length;
    errors.push(`Line ${line}: unterminated url() — remove the incomplete rule`);
  }

  // `image()` can consume a URL string directly or after var() substitution.
  // We do not need this advanced function for local-only themes, so rejecting
  // the function itself is safer than attempting partial grammar resolution.
  // Keyword-presence ban → scan the comment-stripped view so prose like
  // `/* pick an image (large) */` is exempt while a real `image(` is not. The
  // `(` must abut the name (a function-token has no interior whitespace), so a
  // literal `image (` with a space is not the function and is left alone.
  const imageFunctionRegex = /(^|[^\w-])image\(/gim;
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = imageFunctionRegex.exec(stripped)) !== null) {
    const index = imageMatch.index + imageMatch[1].length;
    const line = stripped.slice(0, index).split('\n').length;
    errors.push(`Line ${line}: image(...) is not supported in theme CSS`);
  }

  // `image-set()` accepts URL strings directly, but escape decoding loses the
  // provenance needed to parse its nested string grammar safely. Themes do
  // not need this advanced function, so reject it wholesale like `image()`.
  // Scanned on the comment-stripped view for the same reason as `image()`.
  const imageSetMatch = /image-set\(/i.exec(stripped);
  if (imageSetMatch) {
    const line = stripped.slice(0, imageSetMatch.index).split('\n').length;
    errors.push(`Line ${line}: image-set(...) is not supported in theme CSS`);
  }
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
 * will pass even though the body-scoped base declaration makes it ineffective.
 * Selector-aware validation
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
 * Validate and strip CSS comments, preserving string literals and url-tokens,
 * and replacing each comment with a single space (per CSS spec, comments are
 * whitespace). Called on both the raw source for delimiter provenance and the
 * decoded source used by the contract-warning scan. In raw mode, CSS escapes
 * outside strings are consumed atomically so an escaped quote cannot open a
 * synthetic string and hide a later real comment delimiter.
 *
 * Unlike a naive `replace(/\/\*[\s\S]*?\*\//g, '')`, this tracks strings and
 * unquoted url-tokens so comment-like text inside either is preserved. Real
 * comments collapse to one space to preserve token boundaries for the later
 * contract-presence scan.
 *
 * The decoded-mode call handles escaped string delimiters and comment markers
 * consistently with the contract-warning view; raw mode preserves their
 * source provenance for malformed-comment detection.
 *
 * Unterminated `/*` (no closing `*​/`) is malformed CSS and rejected outright
 * — a benign theme will not contain one, and tolerating it lets an attacker
 * hide a remote `url(...)` after the bogus comment-open.
 */
const stripCssComments = (css: string, isRawSource = false): StripCssResult => {
  let out = '';
  let i = 0;
  let inString: '"' | "'" | null = null;
  let inUrl = false;
  while (i < css.length) {
    const ch = css[i];

    if (inString) {
      out += ch;
      if (isRawSource && (ch === '\n' || ch === '\r' || ch === '\f')) {
        inString = null;
        i++;
        continue;
      }
      if (ch === '\\' && i + 1 < css.length) {
        const escapeLength = isRawSource ? rawCssEscapeLength(css, i) : 2;
        out += css.slice(i + 1, i + escapeLength);
        i += escapeLength;
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

    if (isRawSource && ch === '\\') {
      const escapeLength = rawCssEscapeLength(css, i);
      if (escapeLength > 0) {
        out += css.slice(i, i + escapeLength);
        i += escapeLength;
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i++;
      continue;
    }

    // Detect contiguous `url(` only in the decoded warning view. Raw comment
    // validation intentionally treats `/*` in every unsupported URL/function
    // token as a comment opener; all non-fragment URLs are rejected anyway.
    if (
      !isRawSource &&
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

const rawCssEscapeLength = (css: string, index: number): number =>
  /^\\(?:[0-9a-fA-F]{1,6}(?:[ \t\n\f]|\r\n?)?|\r\n|[\s\S])/.exec(css.slice(index))?.[0]
    .length ?? 0;

/**
 * Decode CSS escapes per CSS Syntax §4.3. Two forms:
 *   1. `\<hex 1-6>` optionally followed by a single whitespace — code point.
 *   2. `\<newline>` — string line continuation, removed.
 *   3. `\<any other non-hex single char>` — literal char.
 *
 * We deliberately decode *inside string literals too*: an attacker could
 * stash `\3a //evil` (escaped `:`) inside `url("...")` as a quoted bare
 * URL. The browser collapses these escapes before fetching, so we must
 * too.
 */
const decodeCssEscapes = (css: string): string =>
  // Hex form: \<1-6 hex>[ \t\n\r\f]?  →  the corresponding code point.
  // Line continuation: \<newline>     →  removed.
  // Literal form: \<single char>      →  that char.
  // Trailing `\` at EOF doesn't match either alternation and is left as-is.
  css.replace(
    /\\([0-9a-fA-F]{1,6})(?:[ \t\n\f]|\r\n?)?|\\(\r\n|[\n\r\f])|\\([\s\S])/g,
    (_m, hex, continuation, lit) => {
      if (continuation !== undefined) return '';
      if (lit !== undefined) return lit;
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff ? '�' : String.fromCodePoint(cp);
    },
  );

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
