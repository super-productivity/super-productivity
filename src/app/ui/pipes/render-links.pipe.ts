import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// URL regex matching URLs with protocol (http, https, file) or www prefix.
// ftp://, ssh://, blob:, etc. are intentionally excluded — they are either
// non-browsable or handled by _isUrlSchemeSafe's denylist for markdown links.
// Limit URL length to 2000 chars to prevent ReDoS attacks.
const URL_REGEX = /(?:(?:https?|file):\/\/\S{1,2000}(?=\s|$)|www\.\S{1,2000}(?=\s|$))/gi;

// Markdown link regex: [title](url)
// The URL group allows one level of balanced parentheses so that links like
// https://en.wikipedia.org/wiki/C_(programming_language) are captured whole.
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)/g;

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

  transform(text: string, renderLinks: boolean = true): SafeHtml {
    if (!text) {
      return '';
    }
    if (!renderLinks) {
      return this._sanitizer.bypassSecurityTrustHtml(this._escapeHtml(text));
    }

    // Fast pre-check: skip expensive regex for plain-text tasks
    const hasUrlHint = text.includes('://') || text.includes('www.');
    const hasMarkdownHint = text.includes('](');
    if (!hasUrlHint && !hasMarkdownHint) {
      return this._sanitizer.bypassSecurityTrustHtml(this._escapeHtml(text));
    }

    return this._sanitizer.bypassSecurityTrustHtml(this._buildLinksHtml(text));
  }

  /**
   * Single-pass link rendering: collects all markdown-link and plain-URL
   * matches sorted by position, then walks the string once, HTML-escaping
   * every text segment and converting each match into an anchor tag.
   * This guarantees no raw user content reaches innerHTML.
   */
  private _buildLinksHtml(text: string): string {
    type Match = {
      index: number;
      end: number;
      isMarkdown: boolean;
      title: string;
      url: string;
    };

    const matches: Match[] = [];

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
        const cleanUrl = this._stripUrlTrailing(raw);
        matches.push({
          index: start,
          // Advance cursor only past cleanUrl so stripped trailing chars
          // (e.g. the ) in "visit (https://example.com)") remain as text.
          end: start + cleanUrl.length,
          isMarkdown: false,
          title: cleanUrl,
          url: cleanUrl,
        });
      }
    }

    if (matches.length === 0) {
      return this._escapeHtml(text);
    }

    matches.sort((a, b) => a.index - b.index);

    const out: string[] = [];
    let cursor = 0;

    for (const match of matches) {
      // Escape the plain-text segment before this match
      out.push(this._escapeHtml(text.slice(cursor, match.index)));

      if (!this._isUrlSchemeSafe(match.url)) {
        // Unsafe URL: render title text only (escaped, no anchor)
        out.push(this._escapeHtml(match.title));
      } else {
        const href = this._normalizeHref(match.url);
        // Plain-URL links use the raw URL as visible text, which is unreadable
        // for screen readers. Add aria-label with just the hostname.
        // Markdown links already have a meaningful title, so skip the label.
        const ariaLabel = match.isMarkdown ? '' : this._ariaLabelForUrl(href);
        out.push(
          `<a href="${this._escapeHtml(href)}"${ariaLabel} target="_blank" rel="noopener noreferrer">${this._escapeHtml(match.title)}</a>`,
        );
      }

      cursor = match.end;
    }

    // Escape any remaining text after the last match
    out.push(this._escapeHtml(text.slice(cursor)));
    return out.join('');
  }

  /** Returns an aria-label attribute string for a plain-URL anchor. */
  private _ariaLabelForUrl(href: string): string {
    try {
      const { hostname } = new URL(href);
      return hostname
        ? ` aria-label="${this._escapeHtml('Open link: ' + hostname)}"`
        : '';
    } catch {
      return '';
    }
  }

  /** Strip trailing punctuation and unmatched closing parentheses from a URL. */
  private _stripUrlTrailing(raw: string): string {
    let url = raw.replace(/[.,;!?]+$/, '');
    // Strip trailing ) only when they exceed the number of opening (.
    // opens is constant during the loop, so we count it once outside.
    const opens = (url.match(/\(/g) || []).length;
    let closes = (url.match(/\)/g) || []).length;
    while (url.endsWith(')') && closes > opens) {
      url = url.slice(0, -1);
      closes--;
    }
    return url;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private _isUrlSchemeSafe(url: string): boolean {
    const lowerUrl = url.trim().toLowerCase();
    const dangerousSchemes = ['javascript:', 'data:', 'vbscript:'];
    if (dangerousSchemes.some((scheme) => lowerUrl.startsWith(scheme))) {
      return false;
    }
    if (
      lowerUrl.startsWith('http://') ||
      lowerUrl.startsWith('https://') ||
      lowerUrl.startsWith('file://') ||
      lowerUrl.startsWith('//')
    ) {
      return true;
    }
    if (!lowerUrl.includes('://')) {
      return true;
    }
    return false;
  }

  private _normalizeHref(url: string): string {
    if (url.match(/^(?:https?|file):\/\//)) {
      return url;
    }
    if (url.startsWith('//')) {
      return `https:${url}`;
    }
    return `http://${url}`;
  }
}
