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
});
