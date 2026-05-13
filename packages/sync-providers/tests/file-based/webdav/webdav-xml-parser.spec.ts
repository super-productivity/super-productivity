import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import {
  WebdavXmlParser,
  type FileMeta,
} from '../../../src/file-based/webdav/webdav-xml-parser';
import { RemoteFileNotFoundAPIError } from '../../../src/errors';

const makeLogger = (): SyncLogger & { critical: ReturnType<typeof vi.fn> } => ({
  ...NOOP_SYNC_LOGGER,
  critical: vi.fn(),
});

const sampleMultistatus = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/sync/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>sync</D:displayname>
        <D:getcontentlength>0</D:getcontentlength>
        <D:getlastmodified>Tue, 12 May 2026 09:00:00 GMT</D:getlastmodified>
        <D:getetag>"folder-etag"</D:getetag>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getcontenttype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/sync/file.txt</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>file.txt</D:displayname>
        <D:getcontentlength>42</D:getcontentlength>
        <D:getlastmodified>Tue, 12 May 2026 09:30:00 GMT</D:getlastmodified>
        <D:getetag>"file-etag"</D:getetag>
        <D:resourcetype/>
        <D:getcontenttype>text/plain</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

describe('WebdavXmlParser', () => {
  describe('PROPFIND_XML', () => {
    it('has the expected request body shape', () => {
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:propfind');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:displayname/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:resourcetype/>');
    });
  });

  describe('isHtmlResponse', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('detects <!doctype html prefix', () => {
      expect(parser.isHtmlResponse('<!DOCTYPE html><html></html>')).toBe(true);
    });
    it('detects <html prefix', () => {
      expect(parser.isHtmlResponse('   <html><body>x</body></html>')).toBe(true);
    });
    it('detects Nextcloud "There is nothing here" message', () => {
      expect(parser.isHtmlResponse('Server: There is nothing here, sorry')).toBe(true);
    });
    it('returns false for XML content', () => {
      expect(parser.isHtmlResponse('<?xml version="1.0"?><a/>')).toBe(false);
    });
  });

  describe('validateResponseContent', () => {
    it('does not throw for normal content', () => {
      const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      expect(() =>
        parser.validateResponseContent('regular file body', 'file.txt', 'download'),
      ).not.toThrow();
    });

    it('throws RemoteFileNotFoundAPIError for HTML error pages', () => {
      const logger = makeLogger();
      const parser = new WebdavXmlParser(logger);
      expect(() =>
        parser.validateResponseContent(
          '<!DOCTYPE html><html><body>login</body></html>',
          'file.txt',
          'download',
        ),
      ).toThrow(RemoteFileNotFoundAPIError);
      expect(logger.critical).toHaveBeenCalled();
      // Privacy invariant: log meta must not echo the response body.
      const [, meta] = logger.critical.mock.calls[0];
      expect(JSON.stringify(meta)).not.toContain('login');
      expect(meta).toEqual(
        expect.objectContaining({ contentLength: expect.any(Number) }),
      );
    });

    it('throws for content above the size cap', () => {
      const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      const huge = 'x'.repeat(101 * 1024 * 1024); // > 100MB
      expect(() => parser.validateResponseContent(huge, 'big', 'download')).toThrow(
        /Response too large/,
      );
    });
  });

  describe('parseMultiplePropsFromXml', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('skips the directory itself and returns child entries', () => {
      const result = parser.parseMultiplePropsFromXml(sampleMultistatus, '/sync/');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/sync/file.txt');
      expect(result[0].type).toBe('file');
    });

    it('parses file metadata (size, lastmod, contentType)', () => {
      const result = parser.parseMultiplePropsFromXml(sampleMultistatus, '/sync/');
      const file = result[0] as FileMeta;
      expect(file.size).toBe(42);
      expect(file.lastmod).toBe('Tue, 12 May 2026 09:30:00 GMT');
      expect(file.data['content-type']).toBe('text/plain');
      expect(file.basename).toBe('file.txt');
    });

    it('identifies directories via <collection/>', () => {
      const result = parser.parseMultiplePropsFromXml(
        sampleMultistatus,
        '/sync/file.txt',
      );
      // When querying a specific file, the directory entry is NOT skipped.
      const dir = result.find((f) => f.path === '/sync/');
      expect(dir?.type).toBe('directory');
    });

    it('returns empty array for invalid XML', () => {
      const logger = makeLogger();
      const parser2 = new WebdavXmlParser(logger);
      const result = parser2.parseMultiplePropsFromXml('not xml at all', '/sync/');
      expect(result).toEqual([]);
    });

    it('defaults size to 0 for malformed content-length', () => {
      const xml = sampleMultistatus.replace(
        '<D:getcontentlength>42',
        '<D:getcontentlength>abc',
      );
      const result = parser.parseMultiplePropsFromXml(xml, '/sync/');
      expect(result[0].size).toBe(0);
    });

    it('throws when XML exceeds size cap', () => {
      const parser2 = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      const huge = 'x'.repeat(11 * 1024 * 1024); // > 10MB cap
      expect(() => parser2.parseMultiplePropsFromXml(huge, '/sync/')).toThrow(
        RemoteFileNotFoundAPIError,
      );
    });
  });

  describe('parseXmlResponseElement (privacy)', () => {
    it('logger meta on parsererror does not leak XML content', () => {
      const logger = makeLogger();
      const parser2 = new WebdavXmlParser(logger);
      // Invalid XML triggers the catch path
      parser2.parseMultiplePropsFromXml('<a><b>', '/');
      // Either parsererror was hit OR catch hit — both paths must NOT log raw content
      for (const [, meta] of logger.critical.mock.calls) {
        if (meta) {
          expect(JSON.stringify(meta)).not.toContain('<b>');
        }
      }
    });
  });

  // ==========================================================================
  // Namespace quirks — the NS-aware `getElementsByTagNameNS('*', name)` lookup
  // is the only reason these all parse uniformly. Originally protected by the
  // pre-package Karma specs; restored here so a future "let's use
  // getElementsByTagName" cleanup that breaks Apache mod_dav / ownCloud /
  // mixed-namespace responses fails loudly.
  // ==========================================================================
  describe('namespace quirks', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('parses lowercase DAV: prefix (the standard case)', () => {
      const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/lower/file</d:href>
    <d:propstat>
      <d:prop><d:displayname>file</d:displayname><d:getcontentlength>1</d:getcontentlength><d:resourcetype/></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      expect(parser.parseMultiplePropsFromXml(xml, '/lower/file')).toHaveLength(1);
    });

    it('parses no-prefix namespace (Apache mod_dav style)', () => {
      const xml = `<?xml version="1.0"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/apache/file</href>
    <propstat>
      <prop><displayname>file</displayname><getcontentlength>2</getcontentlength><resourcetype/></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;
      const r = parser.parseMultiplePropsFromXml(xml, '/apache/file');
      expect(r).toHaveLength(1);
      expect(r[0].size).toBe(2);
    });

    it('parses ownCloud / Nextcloud-style custom namespaces alongside DAV:', () => {
      const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/oc/file</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>file</d:displayname>
        <d:getcontentlength>3</d:getcontentlength>
        <oc:fileid>123</oc:fileid>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      const r = parser.parseMultiplePropsFromXml(xml, '/oc/file');
      expect(r).toHaveLength(1);
      expect(r[0].size).toBe(3);
    });

    it('parses mixed prefixes in the same document', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:">
  <D:response>
    <lp1:href>/mixed/file</lp1:href>
    <D:propstat>
      <D:prop><lp1:displayname>file</lp1:displayname><D:getcontentlength>4</D:getcontentlength><D:resourcetype/></D:prop>
      <lp1:status>HTTP/1.1 200 OK</lp1:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      expect(parser.parseMultiplePropsFromXml(xml, '/mixed/file')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Server-specific response formats — real WebDAV servers vary. Originally
  // protected by the pre-package Karma specs; key formats restored.
  // ==========================================================================
  describe('server-specific response formats', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('parses IIS-style multistatus (URLs that include the host prefix)', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>http://dav.example.com:8080/iis/file</D:href>
    <D:propstat>
      <D:prop><D:displayname>file</D:displayname><D:getcontentlength>5</D:getcontentlength><D:resourcetype/></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      // We don't normalize the href; we preserve what the server sent.
      const r = parser.parseMultiplePropsFromXml(xml, '/iis/file');
      expect(r).toHaveLength(1);
      expect(r[0].path).toBe('http://dav.example.com:8080/iis/file');
    });

    it('parses Nginx mod-dav-style multistatus with HTTP/1.0 in status', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/nginx/file</D:href>
    <D:propstat>
      <D:prop><D:displayname>file</D:displayname><D:getcontentlength>6</D:getcontentlength><D:resourcetype/></D:prop>
      <D:status>HTTP/1.0 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      // status check uses .includes('200 OK') — HTTP/1.0 vs 1.1 doesn't matter
      expect(parser.parseMultiplePropsFromXml(xml, '/nginx/file')).toHaveLength(1);
    });

    it('skips entries with non-200 propstat (207 partial-failure response)', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/ok/file</D:href>
    <D:propstat>
      <D:prop><D:displayname>ok</D:displayname><D:getcontentlength>1</D:getcontentlength><D:resourcetype/></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/forbidden/file</D:href>
    <D:propstat>
      <D:prop><D:displayname>forbidden</D:displayname></D:prop>
      <D:status>HTTP/1.1 403 Forbidden</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      const r = parser.parseMultiplePropsFromXml(xml, '/');
      // Only the 200-status entry is included
      expect(r.map((m) => m.path)).toEqual(['/ok/file']);
    });
  });

  describe('parseXmlResponseElement — null returns', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('returns null when href is missing (recoverable malformed response)', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:propstat>
      <D:prop><D:displayname>orphan</D:displayname><D:resourcetype/></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      expect(parser.parseMultiplePropsFromXml(xml, '/')).toEqual([]);
    });

    it('returns null when propstat is missing', () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/orphan</D:href>
  </D:response>
</D:multistatus>`;
      expect(parser.parseMultiplePropsFromXml(xml, '/')).toEqual([]);
    });
  });

  // ==========================================================================
  // HTML response detection — protects testConnection / download from
  // hashing a login redirect page as if it were file content. Originally
  // covered by the pre-package isHtmlResponse specs; key cases restored.
  // ==========================================================================
  describe('HTML response detection (extra coverage)', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('detects HTML with explicit charset declaration', () => {
      expect(
        parser.isHtmlResponse('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0//EN"><html>'),
      ).toBe(true);
    });

    it('does not flag JSON content as HTML', () => {
      expect(parser.isHtmlResponse('{"foo": "bar"}')).toBe(false);
    });

    it('does not flag plain text starting with "<" but not "<html"', () => {
      expect(parser.isHtmlResponse('<note>this is content</note>')).toBe(false);
    });

    it('detects the Nextcloud anti-pattern "There is nothing here, sorry"', () => {
      expect(
        parser.isHtmlResponse('<some>not html</some>There is nothing here, sorry'),
      ).toBe(true);
    });
  });
});
