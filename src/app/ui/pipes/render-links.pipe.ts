import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/** Hint substrings used for fast pre-checks to skip regex when no URLs/markdown are present. */
export const LINK_HINT_PROTOCOL = '://';
export const LINK_HINT_WWW = 'www.';
export const LINK_HINT_MARKDOWN = '](';

/** Check if text might contain URLs or markdown links (fast string check, no regex). */
export const hasLinkHints = (text: string): boolean =>
  text.includes(LINK_HINT_PROTOCOL) ||
  text.includes(LINK_HINT_WWW) ||
  text.includes(LINK_HINT_MARKDOWN);

// URL regex matching URLs with protocol (http, https, file) or www prefix.
// ftp://, ssh://, blob:, etc. are intentionally excluded — they are either
// non-browsable or handled by _isUrlSchemeSafe's denylist for markdown links.
// Limit URL length to 2000 chars to prevent ReDoS attacks.
const URL_REGEX = /(?:(?:https?|file):\/\/\S{1,2000}(?=\s|$)|www\.\S{1,2000}(?=\s|$))/gi;

// Markdown link regex: [title](url)
// The URL group allows one level of balanced parentheses so that links like
// https://en.wikipedia.org/wiki/C_(programming_language) are captured whole.
// Uses an "unrolled loop" to prevent catastrophic backtracking: [^()]* greedily
// consumes non-parens, then each iteration of the outer * MUST start with a
// literal '(' — so there's only one way to partition the input.
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

// Pre-compiled regexes and lookup tables — avoids per-call overhead.
const HTML_ESCAPE_RE = /[&<>"']/g;
/* eslint-disable @typescript-eslint/naming-convention */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/* eslint-enable @typescript-eslint/naming-convention */
const SCHEME_RE = /^[a-z]+:/i;
const TRAILING_PUNCT_RE = /[.,;!?]+$/;

interface LinkMatch {
  index: number;
  end: number;
  isMarkdown: boolean;
  title: string;
  url: string;
}

/** Single-pass HTML escape using pre-compiled regex + lookup table. */
const _escapeHtml = (text: string): string =>
  text.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);

/** Extract hostname from URL without constructing a URL object. */
const _ariaLabelForUrl = (href: string): string => {
  const protocolEnd = href.indexOf('//');
  if (protocolEnd < 0) {
    return '';
  }
  const hostStart = protocolEnd + 2;
  let hostEnd = href.length;
  for (let i = hostStart; i < href.length; i++) {
    const c = href.charCodeAt(i);
    // Stop at / ? # : (port separator)
    if (c === 47 || c === 63 || c === 35 || c === 58) {
      hostEnd = i;
      break;
    }
  }
  const hostname = href.substring(hostStart, hostEnd);
  return hostname ? ` aria-label="${_escapeHtml('Open link: ' + hostname)}"` : '';
};

/** Strip trailing punctuation and unmatched closing parentheses from a URL. */
const _stripUrlTrailing = (raw: string): string => {
  const url = raw.replace(TRAILING_PUNCT_RE, '');
  // Count parens then strip excess trailing ')' in a single slice.
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 40) opens++;
    else if (c === 41) closes++;
  }
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 41 && closes > opens) {
    end--;
    closes--;
  }
  return end < url.length ? url.substring(0, end) : url;
};

const _isUrlSchemeSafe = (url: string): boolean => {
  const lowerUrl = url.trimStart().toLowerCase();
  if (!lowerUrl) return false;
  if (
    lowerUrl.startsWith('http://') ||
    lowerUrl.startsWith('https://') ||
    lowerUrl.startsWith('file://') ||
    lowerUrl.startsWith('//')
  ) {
    return true;
  }
  // Reject any URL that looks like it has a scheme (letters followed by colon).
  // This catches javascript:, data:, vbscript:, tel:, mailto:, ftp://, ssh://, etc.
  // Does NOT match host:port (e.g. www.example.com:8080) because dots precede the colon.
  if (SCHEME_RE.test(lowerUrl)) {
    return false;
  }
  return true;
};

const _normalizeHref = (url: string): string => {
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://')
  ) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return `http://${url}`;
};

/**
 * Single-pass link rendering: collects all markdown-link and plain-URL
 * matches sorted by position, then walks the string once, HTML-escaping
 * every text segment and converting each match into an anchor tag.
 */
const _buildLinksHtml = (text: string): string => {
  const matches: LinkMatch[] = [];

  // Collect markdown links
  MARKDOWN_LINK_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      isMarkdown: true,
      title: m[1],
      url: m[2],
    });
  }

  // Collect plain URLs not covered by a markdown match
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    const start = m.index;
    if (!matches.some((x) => start >= x.index && start < x.end)) {
      const raw = m[0];
      const cleanUrl = _stripUrlTrailing(raw);
      matches.push({
        index: start,
        end: start + cleanUrl.length,
        isMarkdown: false,
        title: cleanUrl,
        url: cleanUrl,
      });
    }
  }

  if (matches.length === 0) {
    return _escapeHtml(text);
  }

  matches.sort((a, b) => a.index - b.index);

  const out: string[] = [];
  let cursor = 0;

  for (const match of matches) {
    out.push(_escapeHtml(text.slice(cursor, match.index)));

    if (!_isUrlSchemeSafe(match.url)) {
      out.push(_escapeHtml(match.title));
    } else {
      const href = _normalizeHref(match.url);
      const ariaLabel = match.isMarkdown ? '' : _ariaLabelForUrl(href);
      out.push(
        `<a href="${_escapeHtml(href)}"${ariaLabel} target="_blank" rel="noopener noreferrer">${_escapeHtml(match.title)}</a>`,
      );
    }

    cursor = match.end;
  }

  out.push(_escapeHtml(text.slice(cursor)));
  return out.join('');
};

/**
 * Pipe that renders URLs and markdown links as clickable <a> tags.
 * Returns SafeHtml suitable for use with [innerHTML].
 * All user-supplied content is HTML-escaped before insertion to prevent XSS.
 * Dangerous URL schemes (javascript:, data:, vbscript:) are rejected.
 */
@Pipe({
  name: 'renderLinks',
  standalone: true,
  pure: true,
})
export class RenderLinksPipe implements PipeTransform {
  private _sanitizer = inject(DomSanitizer);

  transform(text: string): SafeHtml {
    if (!text) {
      return '';
    }

    // Fast pre-check: skip expensive regex for plain-text tasks
    if (!hasLinkHints(text)) {
      return this._sanitizer.bypassSecurityTrustHtml(_escapeHtml(text));
    }

    return this._sanitizer.bypassSecurityTrustHtml(_buildLinksHtml(text));
  }
}
