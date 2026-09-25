import {
  getGithubErrorUrl,
  getSimpleMeta,
  logAdvancedStacktrace,
} from './global-error-handler.util';
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

  // -----------------------------------------------------------------------
  // #9647 / #7079: crash reports arriving with no "### Stacktrace" section.
  //
  // logAdvancedStacktrace() runs for EVERY error, while the error dialog is
  // built only for the first one. A throw that repeats (a selector crashing on
  // every store emission) trips the 2-per-5s throttle within milliseconds, and
  // the throttled call resolves ''. Writing that '' back into the dialog and the
  // pre-filled GitHub link stripped the raw err.stack the dialog already had,
  // leaving the user with nothing to report.
  // -----------------------------------------------------------------------
  describe('logAdvancedStacktrace', () => {
    const RAW_STACK = 'at doThing (chunk-ABC.js:1:1)';
    const PREFILLED_HREF = 'https://github.com/prefilled-with-raw-stack';

    let spinnerEl: HTMLElement;
    let stacktraceEl: HTMLElement;
    let linkEl: HTMLElement;

    beforeEach(() => {
      spinnerEl = document.createElement('div');
      spinnerEl.id = 'error-fetching-info-wrapper';
      stacktraceEl = document.createElement('pre');
      stacktraceEl.id = 'stack-trace';
      stacktraceEl.textContent = RAW_STACK;
      linkEl = document.createElement('a');
      linkEl.className = 'github-issue-urlX';
      linkEl.setAttribute('href', PREFILLED_HREF);
      document.body.append(spinnerEl, stacktraceEl, linkEl);
    });

    afterEach(() => {
      spinnerEl.remove();
      stacktraceEl.remove();
      linkEl.remove();
    });

    it('should keep the raw stacktrace when no better one can be resolved', async () => {
      // HTTP-shaped errors deterministically resolve to '' — same empty result
      // the throttle produces for a repeating error.
      await logAdvancedStacktrace({
        url: 'https://example.com/api',
        message: 'Boom',
        stack: RAW_STACK,
      });

      expect(stacktraceEl.textContent).toBe(RAW_STACK);
      expect(linkEl.getAttribute('href')).toBe(PREFILLED_HREF);
    });

    it('should still remove the loading spinner when no stack could be resolved', async () => {
      await logAdvancedStacktrace({ url: 'https://example.com/api', message: 'Boom' });

      expect(document.getElementById('error-fetching-info-wrapper')).toBeNull();
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
