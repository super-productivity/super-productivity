import { WebdavXmlParser } from './webdav-xml-parser';

describe('WebdavXmlParser', () => {
  let parser: WebdavXmlParser;

  beforeEach(() => {
    parser = new WebdavXmlParser((rev: string) => rev.replace(/"/g, ''));
  });

  describe('PROPFIND_XML', () => {
    it('should have correct PROPFIND XML structure', () => {
      expect(WebdavXmlParser.PROPFIND_XML).toContain(
        '<?xml version="1.0" encoding="utf-8" ?>',
      );
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:propfind');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:prop>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:getlastmodified/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:getetag/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:getcontenttype/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:resourcetype/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:getcontentlength/>');
    });
  });

  describe('validateResponseContent', () => {
    it('should not throw for valid file content', () => {
      const validContent = 'This is valid file content';
      expect(() => {
        parser.validateResponseContent(validContent, '/test.txt', 'download', 'file');
      }).not.toThrow();
    });

    it('should throw for HTML error pages', () => {
      const htmlError = '<!DOCTYPE html><html><body>404 Not Found</body></html>';
      expect(() => {
        parser.validateResponseContent(htmlError, '/test.txt', 'download', 'file');
      }).toThrow();
    });

    it('should throw for content starting with <!doctype html', () => {
      const htmlContent = '<!doctype html><html><body>Error</body></html>';
      expect(() => {
        parser.validateResponseContent(htmlContent, '/test.txt', 'download', 'file');
      }).toThrow();
    });

    it('should not throw for empty content', () => {
      expect(() => {
        parser.validateResponseContent('', '/test.txt', 'download', 'file');
      }).not.toThrow();
    });
  });

  describe('parseMultiplePropsFromXml', () => {
    it('should parse valid PROPFIND response with single file', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getetag>"abc123"</d:getetag>
                <d:getcontentlength>1234</d:getcontentlength>
                <d:getcontenttype>text/plain</d:getcontenttype>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('test.txt');
      expect(results[0].basename).toBe('test.txt');
      expect(results[0].lastmod).toBe('Wed, 15 Jan 2025 10:00:00 GMT');
      expect(results[0].size).toBe(1234);
      expect(results[0].type).toBe('file');
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT'); // Now using lastmod as etag
      expect(results[0].data['content-type']).toBe('text/plain');
    });

    it('should parse multiple files in PROPFIND response', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/folder/file1.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getetag>"abc123"</d:getetag>
                <d:getcontentlength>100</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/folder/file2.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 11:00:00 GMT</d:getlastmodified>
                <d:getetag>"def456"</d:getetag>
                <d:getcontentlength>200</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/folder/');
      expect(results.length).toBe(2);
      expect(results[0].filename).toBe('file1.txt');
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT'); // Now using lastmod as etag
      expect(results[1].filename).toBe('file2.txt');
      expect(results[1].etag).toBe('Wed, 15 Jan 2025 11:00:00 GMT'); // Now using lastmod as etag
    });

    it('should handle encoded URLs', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/folder/file%20with%20spaces.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getetag>"abc123"</d:getetag>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/folder/');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('file with spaces.txt');
    });

    it('should skip directory itself in directory listing', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/folder/</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:resourcetype><d:collection/></d:resourcetype>
              </d:prop>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/folder/file.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/folder/');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('file.txt');
    });

    it('should NOT skip file when querying specific file path', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/__meta_</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getetag>"meta123"</d:getetag>
                <d:getcontentlength>500</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/__meta_');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('__meta_');
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT'); // Now using lastmod as etag
    });

    it('should handle invalid XML gracefully', () => {
      const invalidXml = '<invalid>not closed';
      const results = parser.parseMultiplePropsFromXml(invalidXml, '/');
      expect(results).toEqual([]);
    });

    it('should handle empty response', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/');
      expect(results).toEqual([]);
    });

    it('should use lastmod as etag when present', () => {
      const cleanRevFn = jasmine
        .createSpy('cleanRevFn')
        .and.callFake((rev: string) => rev.replace(/"/g, '').toUpperCase());
      const customParser = new WebdavXmlParser(cleanRevFn);

      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getetag>"abc123"</d:getetag>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = customParser.parseMultiplePropsFromXml(xml, '/test.txt');
      // cleanRevFn should no longer be called for the etag
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT');
    });

    it('should default size to 0 for malformed content-length', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getcontentlength>not-a-number</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].size).toBe(0);
    });

    it('should default size to 0 for negative content-length', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getcontentlength>-5</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].size).toBe(0);
    });

    it('should handle missing properties gracefully', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT'); // Falls back to lastmod when no etag
      expect(results[0].size).toBe(0);
      expect(results[0].type).toBe('file');
    });

    it('should identify directories correctly', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/folder/subfolder/</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:resourcetype><d:collection/></d:resourcetype>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/folder/');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('directory');
      expect(results[0].filename).toBe(''); // displayname is empty, and href ends with /
    });
  });

  describe('parseXmlResponseElement', () => {
    it('should return null for response without href', () => {
      const doc = new DOMParser().parseFromString(
        '<d:response xmlns:d="DAV:"></d:response>',
        'text/xml',
      );
      const response = doc.querySelector('response')!;
      const result = parser.parseXmlResponseElement(response, '/test');
      expect(result).toBeNull();
    });

    it('should return null for non-200 status', () => {
      const xml = `<d:response xmlns:d="DAV:">
        <d:href>/test.txt</d:href>
        <d:propstat>
          <d:status>HTTP/1.1 404 Not Found</d:status>
        </d:propstat>
      </d:response>`;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const response = doc.querySelector('response')!;
      const result = parser.parseXmlResponseElement(response, '/test.txt');
      expect(result).toBeNull();
    });
  });

  describe('XML Namespace Quirks', () => {
    it('should handle uppercase D: namespace prefix', () => {
      const xml = `<?xml version="1.0"?>
        <D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>/test.txt</D:href>
            <D:propstat>
              <D:status>HTTP/1.1 200 OK</D:status>
              <D:prop>
                <D:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</D:getlastmodified>
                <D:getetag>"abc123"</D:getetag>
              </D:prop>
            </D:propstat>
          </D:response>
        </D:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('test.txt');
    });

    it('should handle no namespace prefix (Apache mod_dav style)', () => {
      const xml = `<?xml version="1.0"?>
        <multistatus xmlns="DAV:">
          <response>
            <href>/test.txt</href>
            <propstat>
              <status>HTTP/1.1 200 OK</status>
              <prop>
                <getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</getlastmodified>
                <getetag>"xyz789"</getetag>
              </prop>
            </propstat>
          </response>
        </multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('test.txt');
    });

    it('should handle ownCloud/Nextcloud custom namespace', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
                <d:getetag>"oc-etag"</d:getetag>
                <oc:id>00000001oc</oc:id>
                <oc:fileid>12345</oc:fileid>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT');
    });

    it('should handle mixed namespace prefixes in same document', () => {
      const xml = `<?xml version="1.0"?>
        <D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:">
          <D:response>
            <D:href>/test.txt</D:href>
            <D:propstat>
              <D:status>HTTP/1.1 200 OK</D:status>
              <D:prop>
                <lp1:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</lp1:getlastmodified>
                <D:getetag>"mixed-ns"</D:getetag>
              </D:prop>
            </D:propstat>
          </D:response>
        </D:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      expect(results.length).toBe(1);
    });
  });

  describe('ETag vs Last-Modified Preference', () => {
    it('should prefer lastmod over etag for revision tracking', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getetag>"etag-value"</d:getetag>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      // Implementation uses lastmod as the etag field for revision tracking
      expect(results[0].etag).toBe('Wed, 15 Jan 2025 10:00:00 GMT');
    });

    it('should use empty string when no lastmod available', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/test.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getetag>"etag-only"</d:getetag>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/test.txt');
      // When no lastmod, should fall back to empty string
      expect(results[0].lastmod).toBe('');
      expect(results[0].etag).toBe('');
    });
  });

  describe('Server-Specific Response Formats', () => {
    it('should handle IIS WebDAV response format', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>http://server/webdav/test.txt</D:href>
            <D:propstat>
              <D:status>HTTP/1.1 200 OK</D:status>
              <D:prop>
                <D:getlastmodified>Mon, 13 Jan 2025 15:30:45 GMT</D:getlastmodified>
                <D:getetag>"0x8D12345"</D:getetag>
                <D:getcontentlength>512</D:getcontentlength>
                <D:resourcetype/>
              </D:prop>
            </D:propstat>
          </D:response>
        </D:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/webdav/test.txt');
      expect(results.length).toBe(1);
      expect(results[0].size).toBe(512);
      expect(results[0].type).toBe('file');
    });

    it('should handle Nginx WebDAV response format', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
          <D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
            <D:href>/dav/test.txt</D:href>
            <D:propstat>
              <D:prop>
                <lp1:getcontentlength>256</lp1:getcontentlength>
                <lp1:getlastmodified>Tue, 14 Jan 2025 09:15:30 GMT</lp1:getlastmodified>
              </D:prop>
              <D:status>HTTP/1.1 200 OK</D:status>
            </D:propstat>
          </D:response>
        </D:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/dav/test.txt');
      expect(results.length).toBe(1);
    });

    it('should handle 207 Multi-Status with partial failures', () => {
      const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/file1.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 10:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/file2.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 404 Not Found</d:status>
              <d:prop>
                <d:getlastmodified/>
              </d:prop>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/file3.txt</d:href>
            <d:propstat>
              <d:status>HTTP/1.1 200 OK</d:status>
              <d:prop>
                <d:getlastmodified>Wed, 15 Jan 2025 11:00:00 GMT</d:getlastmodified>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      const results = parser.parseMultiplePropsFromXml(xml, '/');
      // Should only return successful responses (file1 and file3)
      expect(results.length).toBe(2);
      expect(results.map((r) => r.filename)).toContain('file1.txt');
      expect(results.map((r) => r.filename)).toContain('file3.txt');
    });
  });

  describe('HTML Error Page Detection', () => {
    it('should detect HTML error pages with various content types', () => {
      const htmlVariants = [
        '<!DOCTYPE html><html><body>Error</body></html>',
        '<!doctype html><html><body>Error</body></html>',
        '<html><head><title>Error</title></head><body>500 Internal Server Error</body></html>',
        '<HTML><BODY>Not Found</BODY></HTML>',
      ];

      for (const html of htmlVariants) {
        expect(() => {
          parser.validateResponseContent(html, '/test.txt', 'download', 'file');
        }).toThrow(); // Error is thrown for HTML content
      }
    });

    it('should not flag legitimate XML as HTML error', () => {
      const validXml = '<?xml version="1.0"?><data>test</data>';
      expect(() => {
        parser.validateResponseContent(validXml, '/test.xml', 'download', 'file');
      }).not.toThrow();
    });

    it('should not flag JSON content as HTML error', () => {
      const json = '{"key": "value", "html": "<!DOCTYPE html>"}';
      expect(() => {
        parser.validateResponseContent(json, '/test.json', 'download', 'file');
      }).not.toThrow();
    });
  });
});
