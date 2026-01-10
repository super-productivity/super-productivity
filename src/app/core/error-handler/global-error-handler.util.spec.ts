import { getGithubErrorUrl, getSimpleMeta } from './global-error-handler.util';
import { getErrorTxt } from '../../util/get-error-text';

describe('global-error-handler.util', () => {
  describe('getGithubErrorUrl', () => {
    it('should include error title in URL', () => {
      const url = getGithubErrorUrl('Test error message');
      // URL encoding uses + for spaces in query strings
      expect(url).toContain('Test+error+message');
    });

    it('should prepend error title with crash emoji', () => {
      const url = getGithubErrorUrl('Test error');
      // The title should be URL-encoded "💥 Test error"
      expect(url).toContain('%F0%9F%92%A5'); // 💥 emoji URL-encoded
    });

    it('should include stacktrace in body when provided', () => {
      const url = getGithubErrorUrl('Error', 'at function1\nat function2');
      expect(url).toContain('function1');
    });

    it('should use bug report template', () => {
      const url = getGithubErrorUrl('Error');
      expect(url).toContain('template=in_app_bug_report.md');
    });
  });

  describe('getSimpleMeta', () => {
    it('should return meta info string', () => {
      const meta = getSimpleMeta();
      expect(meta).toContain('META:');
      expect(meta).toContain('SP');
    });
  });

  describe('error title extraction for GitHub URL', () => {
    it('should extract meaningful title from Error object using getErrorTxt', () => {
      const error = new Error('Database connection failed');
      const errorTitle = getErrorTxt(error);
      const url = getGithubErrorUrl(errorTitle);

      // URL encoding uses + for spaces in query strings
      expect(url).toContain('Database+connection+failed');
      expect(url).not.toContain('object+Object');
    });

    it('should extract meaningful title from custom error with name', () => {
      const error = { name: 'ValidationError', code: 500 };
      const errorTitle = getErrorTxt(error);
      const url = getGithubErrorUrl(errorTitle);

      expect(url).toContain('ValidationError');
      expect(url).not.toContain('object+Object');
    });

    it('should never produce [object Object] in GitHub URL title', () => {
      // This test ensures the fix for issue #5822 works correctly
      const errorCases = [
        new Error('Standard error'),
        new TypeError('Type error'),
        { message: 'Object with message' },
        { name: 'NamedError' },
        { error: { message: 'Nested error' } },
        { statusText: 'Not Found' },
        { code: 500, details: 'Server error' }, // Object without standard props
      ];

      for (const error of errorCases) {
        const errorTitle = getErrorTxt(error);
        const url = getGithubErrorUrl(errorTitle);

        // URL encoding uses + for spaces in query strings
        expect(url).not.toContain('object+Object');
        expect(errorTitle).not.toBe('[object Object]');
      }
    });
  });
});
