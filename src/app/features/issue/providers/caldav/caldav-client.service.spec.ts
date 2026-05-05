import { TestBed } from '@angular/core/testing';
import { CaldavClientService } from './caldav-client.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { CaldavCfg } from './caldav.model';

// ─── _getParentRelatedTo ──────────────────────────────────────────────────────

describe('CaldavClientService._getParentRelatedTo', () => {
  const getParentRelatedTo = (todo: unknown): string | undefined =>
    (CaldavClientService as any)._getParentRelatedTo(todo);

  const makeTodo = (
    relProps: { value: string; reltype?: string }[],
  ): { getAllProperties: (name: string) => unknown[] } => ({
    getAllProperties: (_name: string) =>
      relProps.map((p) => ({
        getParameter: (param: string) =>
          param === 'reltype' ? (p.reltype ?? null) : null,
        getFirstValue: () => p.value,
      })),
  });

  it('should return UID when RELTYPE is absent (defaults to PARENT per RFC 5545)', () => {
    expect(getParentRelatedTo(makeTodo([{ value: 'parent-uid' }]))).toBe('parent-uid');
  });

  it('should return UID when RELTYPE=PARENT', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'parent-uid', reltype: 'PARENT' }])),
    ).toBe('parent-uid');
  });

  it('should return UID when RELTYPE=parent (case-insensitive)', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'parent-uid', reltype: 'parent' }])),
    ).toBe('parent-uid');
  });

  it('should ignore RELTYPE=CHILD and return undefined', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'child-uid', reltype: 'CHILD' }])),
    ).toBeUndefined();
  });

  it('should ignore RELTYPE=SIBLING and return undefined', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'sibling-uid', reltype: 'SIBLING' }])),
    ).toBeUndefined();
  });

  it('should skip CHILD/SIBLING and return the first PARENT in a mixed list', () => {
    expect(
      getParentRelatedTo(
        makeTodo([
          { value: 'sibling-uid', reltype: 'SIBLING' },
          { value: 'child-uid', reltype: 'CHILD' },
          { value: 'parent-uid', reltype: 'PARENT' },
        ]),
      ),
    ).toBe('parent-uid');
  });

  it('should return undefined when there are no RELATED-TO properties', () => {
    expect(getParentRelatedTo(makeTodo([]))).toBeUndefined();
  });

  it('should return undefined when RELATED-TO value is empty string', () => {
    expect(getParentRelatedTo(makeTodo([{ value: '' }]))).toBeUndefined();
  });
});

// ─── _getXhrProvider / _getAndroidXhrProvider ─────────────────────────────────

const MOCK_CFG: CaldavCfg = {
  caldavUrl: 'https://cal.example.com',
  resourceName: 'Personal',
  username: 'user',
  password: 'secret',
  categoryFilter: null,
  isEnabled: true,
};

const EXPECTED_AUTH = 'Basic ' + btoa('user:secret');

/** Subclass that makes platform detection and native HTTP injectable for tests. */
class TestableCaldavClientService extends CaldavClientService {
  private _isNativePlatformValue = false;

  webDavRequestSpy = jasmine.createSpy('_webDavRequest').and.resolveTo({
    status: 207,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'content-type': 'application/xml' },
    data: '<multistatus/>',
  });

  setIsNativePlatform(v: boolean): void {
    this._isNativePlatformValue = v;
  }

  protected override get isNativePlatform(): boolean {
    return this._isNativePlatformValue;
  }

  protected override _webDavRequest(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: string;
  }): Promise<{ status: number; headers: Record<string, string>; data: string }> {
    return this.webDavRequestSpy(options);
  }
}

describe('CaldavClientService._getXhrProvider – web platform', () => {
  let svc: TestableCaldavClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CaldavClientService, useClass: TestableCaldavClientService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    svc = TestBed.inject(CaldavClientService) as TestableCaldavClientService;
    svc.setIsNativePlatform(false);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('returns a real XMLHttpRequest on the web platform', () => {
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    expect(xhr instanceof XMLHttpRequest).toBeTrue();
  });

  it('injects Authorization and X-Requested-With headers when open() is called', () => {
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    const headers: Record<string, string> = {};
    spyOn(xhr, 'setRequestHeader').and.callFake(
      (name: string, value: string) => (headers[name] = value),
    );
    xhr.open('REPORT', 'https://cal.example.com/');
    expect(headers['Authorization']).toBe(EXPECTED_AUTH);
    expect(headers['X-Requested-With']).toBe('SuperProductivity');
  });
});

describe('CaldavClientService._getAndroidXhrProvider – native platform', () => {
  let svc: TestableCaldavClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CaldavClientService, useClass: TestableCaldavClientService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    svc = TestBed.inject(CaldavClientService) as TestableCaldavClientService;
    svc.setIsNativePlatform(true);
  });

  afterEach(() => TestBed.resetTestingModule());

  const getFakeXhr = (cfg = MOCK_CFG): XMLHttpRequest =>
    (svc as any)._getAndroidXhrProvider(cfg)();

  it('_getXhrProvider routes to native provider and returns a fake XHR', () => {
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    expect(xhr instanceof XMLHttpRequest).toBeFalse();
  });

  it('fake XHR exposes the required XHR interface', () => {
    const xhr = getFakeXhr();
    expect(typeof xhr.open).toBe('function');
    expect(typeof xhr.send).toBe('function');
    expect(typeof xhr.setRequestHeader).toBe('function');
    expect(typeof xhr.getResponseHeader).toBe('function');
    expect(typeof xhr.getAllResponseHeaders).toBe('function');
    expect(typeof xhr.addEventListener).toBe('function');
    expect(typeof xhr.removeEventListener).toBe('function');
    expect(typeof xhr.abort).toBe('function');
  });

  it('getResponseHeader returns null before any response', () => {
    const xhr = getFakeXhr();
    expect(xhr.getResponseHeader('content-type')).toBeNull();
  });

  it('getAllResponseHeaders returns empty string before any response', () => {
    const xhr = getFakeXhr();
    expect(xhr.getAllResponseHeaders()).toBe('');
  });

  it('send() passes Authorization and X-Requested-With headers to _webDavRequest', async () => {
    const xhr = getFakeXhr();
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    const callArgs = svc.webDavRequestSpy.calls.mostRecent().args[0];
    expect(callArgs.headers?.['Authorization']).toBe(EXPECTED_AUTH);
    expect(callArgs.headers?.['X-Requested-With']).toBe('SuperProductivity');
  });

  it('send() passes extra headers set via setRequestHeader()', async () => {
    const xhr = getFakeXhr();
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.setRequestHeader('Depth', '1');
    xhr.send('<body/>');
    await Promise.resolve();
    const callArgs = svc.webDavRequestSpy.calls.mostRecent().args[0];
    expect(callArgs.headers?.['Depth']).toBe('1');
    expect(callArgs.data).toBe('<body/>');
  });

  it('fires onload and sets status/responseText after send() resolves', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 207,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'application/xml' },
      data: '<multistatus/>',
    });
    const xhr = getFakeXhr();
    let loadFired = false;
    xhr.onload = () => (loadFired = true);
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(loadFired).toBeTrue();
    expect(xhr.status).toBe(207);
    expect(xhr.responseText).toBe('<multistatus/>');
    expect(xhr.readyState).toBe(4);
  });

  it('fires load event listeners registered via addEventListener()', async () => {
    const xhr = getFakeXhr();
    const listener = jasmine.createSpy('loadListener');
    xhr.addEventListener('load', listener);
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not fire removed event listeners', async () => {
    const xhr = getFakeXhr();
    const listener = jasmine.createSpy('loadListener');
    xhr.addEventListener('load', listener);
    xhr.removeEventListener('load', listener);
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires onerror and readyState=4 when _webDavRequest rejects', async () => {
    svc.webDavRequestSpy.and.rejectWith(new Error('network failure'));
    const xhr = getFakeXhr();
    let errorFired = false;
    xhr.onerror = () => (errorFired = true);
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(errorFired).toBeTrue();
    expect(xhr.readyState).toBe(4);
  });

  it('populates responseHeaders accessible via getResponseHeader after send()', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 207,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      data: '',
    });
    const xhr = getFakeXhr();
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(xhr.getResponseHeader('content-type')).toBe('application/xml; charset=utf-8');
  });

  it('getAllResponseHeaders returns formatted header string after send()', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 207,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'text/xml', etag: '"abc"' },
      data: '',
    });
    const xhr = getFakeXhr();
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    const all = xhr.getAllResponseHeaders();
    expect(all).toContain('content-type: text/xml');
    expect(all).toContain('etag: "abc"');
  });

  it('removeEventListener is idempotent (does not throw when listener absent)', () => {
    const xhr = getFakeXhr();
    const cb = jasmine.createSpy('cb');
    xhr.addEventListener('load', cb);
    xhr.removeEventListener('load', cb);
    expect(() => xhr.removeEventListener('load', cb)).not.toThrow();
  });

  it('abort() does not throw', () => {
    const xhr = getFakeXhr();
    expect(() => xhr.abort()).not.toThrow();
  });
});
