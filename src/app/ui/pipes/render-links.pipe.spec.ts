import { TestBed } from '@angular/core/testing';
import { SafeHtml } from '@angular/platform-browser';
import { RenderLinksPipe } from './render-links.pipe';

/** Extract the raw HTML string from a SafeHtml returned by the pipe. */
const html = (result: SafeHtml | string): string => {
  if (typeof result === 'string') return result;
  return (result as any).changingThisBreaksApplicationSecurity as string;
};

describe('RenderLinksPipe', () => {
  let pipe: RenderLinksPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RenderLinksPipe] });
    pipe = TestBed.inject(RenderLinksPipe);
  });

  describe('XSS Protection', () => {
    it('should HTML-escape content in markdown link titles, preventing XSS', () => {
      const result = html(
        pipe.transform('Task [<img src=x onerror=alert(1)>](https://example.com)', true),
      );
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });

    it('should HTML-escape raw HTML tags surrounding a URL', () => {
      const result = html(
        pipe.transform('<img src=x onerror=alert(1)> see https://example.com', true),
      );
      expect(result).not.toContain('<img src=x');
      expect(result).toContain('&lt;img src=x');
      expect(result).toContain('href="https://example.com"');
    });

    it('should HTML-escape script tags in plain URL display text', () => {
      const result = html(
        pipe.transform('Task https://evil.com/<script>alert(1)</script>', true),
      );
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('https://evil.com/');
    });

    it('should escape quote characters in href attributes to prevent attribute breakout', () => {
      const result = html(
        pipe.transform('Task [link](https://evil.com/"onmouseover="alert(1))', true),
      );
      expect(result).toContain('&quot;onmouseover=&quot;');
      // The balanced (1) is included in the captured URL (regex supports one level
      // of balanced parens), so the href ends with alert(1) — still safely escaped.
      expect(result).toContain(
        'href="https://evil.com/&quot;onmouseover=&quot;alert(1)"',
      );
    });

    it('should escape ampersands in URLs', () => {
      const result = html(pipe.transform('Task https://example.com?a=1&b=2', true));
      expect(result).toContain('&amp;');
    });

    it('should return plain text (no anchor tags) when no URLs are present', () => {
      const result = html(pipe.transform('Just plain text task', true));
      expect(result).not.toContain('<a ');
    });

    it('should explicitly reject javascript: URLs in markdown links', () => {
      const result = html(pipe.transform('[Click](javascript:alert(1))', true));
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<a ');
    });

    it('should explicitly reject data: URLs', () => {
      const result = html(
        pipe.transform('[Click](data:text/html,<script>alert(1)</script>)', true),
      );
      expect(result).not.toContain('data:');
      expect(result).not.toContain('<a ');
    });

    it('should explicitly reject vbscript: URLs', () => {
      const result = html(pipe.transform('[Click](vbscript:msgbox(1))', true));
      expect(result).not.toContain('vbscript:');
      expect(result).not.toContain('<a ');
    });

    it('should allow safe protocols (http, https, file)', () => {
      const result = html(
        pipe.transform(
          '[HTTP](http://example.com) [HTTPS](https://example.com) [FILE](file:///path)',
          true,
        ),
      );
      expect(result).toContain('http://example.com');
      expect(result).toContain('https://example.com');
      expect(result).toContain('file:///path');
      expect((result.match(/<a /g) || []).length).toBe(3);
    });
  });

  describe('Mixed Content', () => {
    it('should render both markdown links and plain URLs in the same title', () => {
      const result = html(
        pipe.transform('Review [docs](https://docs.com) and https://example.com', true),
      );
      expect(result).toContain('href="https://docs.com"');
      expect(result).toContain('>docs</a>');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('>https://example.com</a>');
      expect((result.match(/<a /g) || []).length).toBe(2);
    });

    it('should not double-process URLs that are already in markdown links', () => {
      const result = html(
        pipe.transform('[https://example.com](https://example.com)', true),
      );
      expect((result.match(/<a /g) || []).length).toBe(1);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('>https://example.com</a>');
    });

    it('should handle multiple markdown links and multiple plain URLs', () => {
      const result = html(
        pipe.transform(
          'Check [docs](https://docs.com) and [api](https://api.com), also see https://example.com and https://github.com',
          true,
        ),
      );
      expect((result.match(/<a /g) || []).length).toBe(4);
      expect(result).toContain('href="https://docs.com"');
      expect(result).toContain('href="https://api.com"');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('href="https://github.com"');
    });
  });

  describe('aria-label on plain-URL links', () => {
    it('should add aria-label with the hostname for auto-detected URLs', () => {
      const result = html(pipe.transform('See https://github.com/some/path here', true));
      expect(result).toContain('aria-label="Open link: github.com"');
    });

    it('should not add aria-label to markdown links (title already provides context)', () => {
      const result = html(pipe.transform('[GitHub](https://github.com/some/path)', true));
      expect(result).not.toContain('aria-label=');
    });

    it('should omit aria-label when hostname cannot be determined', () => {
      // www. URLs are normalised to http:// so hostname is available
      const result = html(pipe.transform('See www.example.com here', true));
      expect(result).toContain('aria-label="Open link: www.example.com"');
    });
  });

  describe('renderLinks=false', () => {
    it('should return escaped plain text without anchor tags', () => {
      const result = html(pipe.transform('Check https://example.com', false));
      expect(result).not.toContain('<a ');
      expect(result).toContain('https://example.com');
    });
  });

  describe('URL parsing: parentheses in markdown links', () => {
    it('should capture a Wikipedia-style URL with balanced parens', () => {
      const result = html(
        pipe.transform(
          '[C language](https://en.wikipedia.org/wiki/C_(programming_language))',
          true,
        ),
      );
      expect(result).toContain(
        'href="https://en.wikipedia.org/wiki/C_(programming_language)"',
      );
      expect((result.match(/<a /g) || []).length).toBe(1);
    });

    it('should not truncate plain URLs with balanced parens', () => {
      const result = html(
        pipe.transform(
          'See https://en.wikipedia.org/wiki/C_(programming_language) here',
          true,
        ),
      );
      expect(result).toContain(
        'href="https://en.wikipedia.org/wiki/C_(programming_language)"',
      );
    });
  });

  describe('URL parsing: trailing ) stripping', () => {
    it('should strip a trailing ) when the URL is written in parentheses', () => {
      const result = html(pipe.transform('Visit (https://example.com) for info', true));
      expect(result).toContain('href="https://example.com"');
      expect(result).not.toContain('href="https://example.com)"');
      // The closing ) of the sentence should appear as text
      expect(result).toContain(') for info');
    });

    it('should not strip ) when it belongs to the URL (balanced parens)', () => {
      const result = html(
        pipe.transform(
          'See https://en.wikipedia.org/wiki/C_(programming_language) here',
          true,
        ),
      );
      expect(result).toContain(
        'href="https://en.wikipedia.org/wiki/C_(programming_language)"',
      );
    });
  });

  describe('URL scheme allowlist', () => {
    it('should render ftp:// markdown link as plain title text, not a link', () => {
      // ftp:// is intentionally excluded from the safe-scheme allowlist.
      // The title text should appear but without an anchor.
      const result = html(
        pipe.transform('[My FTP server](ftp://files.example.com)', true),
      );
      expect(result).toContain('My FTP server');
      expect(result).not.toContain('<a ');
      expect(result).not.toContain('href=');
    });

    it('should render ssh:// markdown link as plain title text, not a link', () => {
      const result = html(pipe.transform('[SSH](ssh://server.example.com)', true));
      expect(result).toContain('SSH');
      expect(result).not.toContain('<a ');
    });
  });

  describe('URL parsing: trailing punctuation stripping', () => {
    it('should strip a trailing comma from an auto-detected URL', () => {
      const result = html(pipe.transform('See https://example.com, for details', true));
      expect(result).toContain('href="https://example.com"');
      expect(result).not.toContain('href="https://example.com,"');
      expect(result).toContain(', for details');
    });

    it('should strip a trailing period from an auto-detected URL', () => {
      const result = html(pipe.transform('Go to https://example.com.', true));
      expect(result).toContain('href="https://example.com"');
      expect(result).not.toContain('href="https://example.com."');
    });
  });

  describe('ReDoS protection', () => {
    it('should handle extremely long URLs without performance degradation', () => {
      const prefix = 'https://example.com/';
      const longUrl = `${prefix}${'a'.repeat(1990 - prefix.length)}`;

      const startTime = performance.now();
      const result = html(pipe.transform(`Check ${longUrl} for details`, true));

      expect(performance.now() - startTime).toBeLessThan(100);
      expect(result).toContain('href=');
    });

    it('should handle URLs at exactly 2000 characters', () => {
      const prefix = 'https://example.com/';
      const longUrl = `${prefix}${'a'.repeat(2000 - prefix.length)}`;
      const result = html(pipe.transform(longUrl, true));
      expect(result).toContain('href=');
      expect(result).toContain(longUrl);
    });
  });
});
