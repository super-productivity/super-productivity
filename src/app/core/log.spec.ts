import { HttpErrorResponse } from '@angular/common/http';
import { Log } from './log';

describe('Log', () => {
  const SECRET_URL = 'https://cal.example.com/private-SECRET_TOKEN/basic.ics';
  const SECRET_BODY = 'SECRET_RESPONSE_BODY';
  const httpError = (): HttpErrorResponse =>
    new HttpErrorResponse({
      url: SECRET_URL,
      status: 404,
      statusText: 'Not Found',
      error: SECRET_BODY,
    });

  beforeEach(() => {
    Log.clearLogHistory();
  });

  afterEach(() => {
    Log.clearLogHistory();
  });

  it('exports only the status of an HttpErrorResponse passed as a later argument', () => {
    Log.err('request failed', httpError());

    const exported = Log.exportLogHistory();
    expect(exported).not.toContain('SECRET');
    expect(exported).toContain('404');
  });

  it('exports only the status of an HttpErrorResponse passed as the first argument', () => {
    Log.err(httpError());

    const exported = Log.exportLogHistory();
    expect(exported).not.toContain('SECRET');
    expect(exported).toContain('404');
  });

  it('keeps a hand-scrubbed object that copies the HttpErrorResponse name', () => {
    Log.err('CAL_PROVIDER_REQUEST_ERROR', {
      icalHost: 'cal.example.com',
      name: 'HttpErrorResponse',
      status: 404,
    });

    expect(Log.exportLogHistory()).toContain('cal.example.com');
  });

  describe('home directory redaction (#11502)', () => {
    const WIN_STACK =
      'Error: Global Shortcut registration failed: Ctrl+Shift+X\n' +
      '    at errorHandlerWithFrontendInform (C:\\Users\\alice\\AppData\\Local\\Temp\\resources\\app.asar\\electron\\error-handler-with-frontend-inform.js:9:20)';

    it('redacts a Windows user folder from an Error stack passed as an argument', () => {
      const err = new Error('boom');
      err.stack = WIN_STACK;
      Log.err('global shortcut', err);

      const exported = Log.exportLogHistory();
      expect(exported).not.toContain('alice');
      expect(exported).toContain('AppData');
    });

    it('redacts a Windows user folder inside an already-serialized message (issue shape)', () => {
      // electron forwards the error as a JSON string, so the path is escaped twice
      Log.err({ error: 'Global Shortcut registration failed', stack: WIN_STACK });
      Log.err(JSON.stringify({ stack: WIN_STACK }));

      const exported = Log.exportLogHistory();
      expect(exported).not.toContain('alice');
      expect(() => JSON.parse(exported)).not.toThrow();
    });

    it('redacts Windows user folders with spaces, forward slashes and lowercase', () => {
      Log.err('at C:\\Users\\Alice Smith\\app.js');
      Log.err('file:///C:/Users/alice/app.asar/index.html');
      Log.err('at c:\\users\\alice\\app.js');
      Log.err('at C:\\Users\\alice (work)\\app.js');

      const exported = Log.exportLogHistory();
      expect(exported).not.toMatch(/alice/i);
      expect(exported).toContain('app.asar');
    });

    it('redacts macOS and Linux home folders', () => {
      Log.err('at fn (/Users/alice/Library/app.js:1:2)');
      Log.err('at file:///home/alice/.config/app.js:1:2');

      const exported = Log.exportLogHistory();
      expect(exported).not.toContain('alice');
      expect(exported).toContain('Library');
      expect(exported).toContain('.config');
    });

    it('keeps URL paths that merely contain /home/ or /Users/', () => {
      Log.err('GET https://api.example.com/home/feed and https://x.example.com/Users/42');

      const exported = Log.exportLogHistory();
      expect(exported).toContain('example.com/home/feed');
      expect(exported).toContain('example.com/Users/42');
    });

    it('redacts the text export too', () => {
      Log.err('at /home/alice/app.js');

      expect(Log.exportLogHistoryAsText()).not.toContain('alice');
    });
  });
});
