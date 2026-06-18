import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { CaldavClientService } from './caldav-client.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { CaldavCfg } from './caldav.model';
import { CaldavIssue } from './caldav-issue.model';

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

const makeIssue = (id: string): CaldavIssue => ({
  id,
  completed: false,
  item_url: `/${id}`,
  summary: id,
  labels: [],
  etag_hash: 1,
});

interface TestCalendarLike {
  displayname?: string;
  url: string;
  calendarQuery: jasmine.Spy;
}

interface TestCalendarHomeLike {
  displayname?: string;
  url: string;
  findAllCalendars: jasmine.Spy<() => Promise<TestCalendarLike[]>>;
}

interface TestClientCacheLike {
  client: { calendarHomes: TestCalendarHomeLike[] };
  calendars: Map<string, TestCalendarLike>;
}

interface TestGetClientTarget {
  _get_client: (cfg: CaldavCfg) => Promise<TestClientCacheLike>;
}

interface TestGetCalendarTarget {
  _getCalendar: (cfg: CaldavCfg) => Promise<TestCalendarLike>;
}

const makeCalendar = (
  url: string,
  displayname?: string,
  canQuery = true,
): TestCalendarLike => ({
  url,
  displayname,
  calendarQuery: jasmine.createSpy('calendarQuery').and.resolveTo(canQuery ? [] : null),
});

const makeCalendarHome = (
  url: string,
  calendars: TestCalendarLike[],
  displayname?: string,
): TestCalendarHomeLike => ({
  url,
  displayname,
  findAllCalendars: jasmine.createSpy('findAllCalendars').and.resolveTo(calendars),
});

const makeFailingCalendarHome = (
  url: string,
  error: Error,
  displayname?: string,
): TestCalendarHomeLike => ({
  url,
  displayname,
  findAllCalendars: jasmine.createSpy('findAllCalendars').and.rejectWith(error),
});

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

  it('returns an empty DAV response header when the server does not expose it', () => {
    spyOn(XMLHttpRequest.prototype, 'getResponseHeader').and.returnValue(null);
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    expect(xhr.getResponseHeader('DAV')).toBe('');
  });

  it('preserves non-DAV missing response headers as null', () => {
    spyOn(XMLHttpRequest.prototype, 'getResponseHeader').and.returnValue(null);
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    expect(xhr.getResponseHeader('content-type')).toBeNull();
  });
});

describe('CaldavClientService.getByIds$', () => {
  let svc: CaldavClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CaldavClientService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    svc = TestBed.inject(CaldavClientService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('returns only tasks matching the requested ids', async () => {
    spyOn(svc as any, '_getTasks').and.resolveTo([
      makeIssue('task-10'),
      makeIssue('1'),
      makeIssue('other'),
    ]);

    const result = await firstValueFrom(svc.getByIds$(['task-10', 'other'], MOCK_CFG));

    expect(result.map((issue) => issue.id)).toEqual(['task-10', 'other']);
  });
});

describe('CaldavClientService._getCalendar', () => {
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
  });

  afterEach(() => TestBed.resetTestingModule());

  it('finds a calendar from later calendar homes when the first home has no match', async () => {
    const laterCalendar = makeCalendar('/dav/projects/12/', 'Inbox');
    const firstHome = makeCalendarHome('/dav/calendars/', [
      makeCalendar('/dav/calendars/archive/', 'Archive'),
    ]);
    const secondHome = makeCalendarHome('/dav/projects/', [laterCalendar]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [firstHome, secondHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    const calendar = await (svc as unknown as TestGetCalendarTarget)._getCalendar({
      ...MOCK_CFG,
      resourceName: 'Inbox',
    });

    expect(calendar).toBe(laterCalendar);
    expect(firstHome.findAllCalendars).toHaveBeenCalledTimes(1);
    expect(secondHome.findAllCalendars).toHaveBeenCalledTimes(1);
  });

  it('preserves displayname precedence over matching URL segments', async () => {
    const urlSegmentMatch = makeCalendar('/dav/projects/Personal/', 'Work');
    const displayNameMatch = makeCalendar('/dav/projects/b123/', 'Personal');
    const projectsHome = makeCalendarHome('/dav/projects/', [
      urlSegmentMatch,
      displayNameMatch,
    ]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [projectsHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    const calendar = await (svc as unknown as TestGetCalendarTarget)._getCalendar({
      ...MOCK_CFG,
      resourceName: 'Personal',
    });

    expect(calendar).toBe(displayNameMatch);
  });

  it('does not select the Vikunja projects home when resourceName matches the home', async () => {
    const projectsHomeCollection = makeCalendar('/dav/projects/', 'projects', false);
    const projectsHome = makeCalendarHome('/dav/projects/', [projectsHomeCollection]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [projectsHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    await expectAsync(
      (svc as unknown as TestGetCalendarTarget)._getCalendar({
        ...MOCK_CFG,
        caldavUrl: 'http://192.168.0.5:3456/dav/principals/loki/',
        resourceName: 'projects',
        username: 'loki',
      }),
    ).toBeRejectedWithError('CALENDAR NOT FOUND: projects');
  });

  it('does not silently map a home resource to the only concrete project', async () => {
    const inboxProject = makeCalendar('/dav/projects/12/', 'Inbox');
    const projectsHome = makeCalendarHome('/dav/projects/', [inboxProject]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [projectsHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    await expectAsync(
      (svc as unknown as TestGetCalendarTarget)._getCalendar({
        ...MOCK_CFG,
        caldavUrl: 'http://192.168.0.5:3456/dav/principals/loki/',
        resourceName: 'projects',
        username: 'loki',
      }),
    ).toBeRejectedWithError('CALENDAR NOT FOUND: projects');
  });

  it('selects a concrete Vikunja project by display name while skipping the home collection', async () => {
    const projectsHomeCollection = makeCalendar('/dav/projects/', 'projects', false);
    const inboxProject = makeCalendar('/dav/projects/12/', 'Inbox');
    const projectsHome = makeCalendarHome('/dav/projects/', [
      projectsHomeCollection,
      inboxProject,
    ]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [projectsHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    const calendar = await (svc as unknown as TestGetCalendarTarget)._getCalendar({
      ...MOCK_CFG,
      caldavUrl: 'http://192.168.0.5:3456/dav/principals/loki/',
      resourceName: 'Inbox',
      username: 'loki',
    });

    expect(calendar).toBe(inboxProject);
  });

  it('selects a concrete Vikunja project by final URL segment while skipping the home collection', async () => {
    const projectsHomeCollection = makeCalendar('/dav/projects/', 'projects', false);
    const inboxProject = makeCalendar('/dav/projects/12/', 'Inbox');
    const projectsHome = makeCalendarHome('/dav/projects/', [
      projectsHomeCollection,
      inboxProject,
    ]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [projectsHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    const calendar = await (svc as unknown as TestGetCalendarTarget)._getCalendar({
      ...MOCK_CFG,
      caldavUrl: 'http://192.168.0.5:3456/dav/principals/loki/',
      resourceName: '12',
      username: 'loki',
    });

    expect(calendar).toBe(inboxProject);
  });

  it('continues to later calendar homes when an earlier home fails', async () => {
    const firstHome = makeFailingCalendarHome(
      '/dav/broken/',
      new Error('temporary failure'),
    );
    const secondHomeCalendar = makeCalendar('/dav/projects/12/', 'Inbox');
    const secondHome = makeCalendarHome('/dav/projects/', [secondHomeCalendar]);
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [firstHome, secondHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    const calendar = await (svc as unknown as TestGetCalendarTarget)._getCalendar({
      ...MOCK_CFG,
      resourceName: 'Inbox',
    });

    expect(calendar).toBe(secondHomeCalendar);
    expect(firstHome.findAllCalendars).toHaveBeenCalledTimes(1);
    expect(secondHome.findAllCalendars).toHaveBeenCalledTimes(1);
  });

  it('surfaces a network error when all calendar homes fail', async () => {
    const firstHome = makeFailingCalendarHome('/dav/broken-1/', new Error('failure 1'));
    const secondHome = makeFailingCalendarHome('/dav/broken-2/', new Error('failure 2'));
    spyOn(svc as unknown as TestGetClientTarget, '_get_client').and.resolveTo({
      client: { calendarHomes: [firstHome, secondHome] },
      calendars: new Map<string, TestCalendarLike>(),
    });

    await expectAsync(
      (svc as unknown as TestGetCalendarTarget)._getCalendar({
        ...MOCK_CFG,
        resourceName: 'Inbox',
      }),
    ).toBeRejectedWithError(/CALDAV NETWORK ERROR/);
  });
});

describe('CaldavClientService._getNativeXhrProvider – native platform', () => {
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
    (svc as any)._getNativeXhrProvider(cfg)();

  it('_getXhrProvider routes to native provider and returns a fake XHR', () => {
    const factory: () => XMLHttpRequest = (svc as any)._getXhrProvider(MOCK_CFG);
    const xhr = factory();
    expect(xhr instanceof XMLHttpRequest).toBeFalse();
  });

  // ── cdav-library contract: onreadystatechange is the sole completion handler ──

  it('fires onreadystatechange with readyState=4 on success (cdav-library v1.5.3 contract)', async () => {
    const xhr = getFakeXhr();
    let capturedReadyState = -1;
    // Mirrors the pattern in @nextcloud/cdav-library/dist/index.mjs:876
    xhr.onreadystatechange = (): void => {
      if (xhr.readyState !== 4) return;
      capturedReadyState = xhr.readyState;
    };
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(capturedReadyState).toBe(4);
  });

  it('fires onreadystatechange with readyState=4 on network error', async () => {
    svc.webDavRequestSpy.and.rejectWith(new Error('network failure'));
    const xhr = getFakeXhr();
    let capturedReadyState = -1;
    xhr.onreadystatechange = (): void => {
      if (xhr.readyState !== 4) return;
      capturedReadyState = xhr.readyState;
    };
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(capturedReadyState).toBe(4);
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

  it('returns an empty DAV response header when native HTTP omits it', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 207,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'application/xml' },
      data: '',
    });
    const xhr = getFakeXhr();
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    await Promise.resolve();
    expect(xhr.getResponseHeader('DAV')).toBe('');
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

  // ── abort() ───────────────────────────────────────────────────────────────────

  it('abort() does not throw', () => {
    const xhr = getFakeXhr();
    expect(() => xhr.abort()).not.toThrow();
  });

  it('abort() fires onabort immediately', () => {
    const xhr = getFakeXhr();
    let abortFired = false;
    (xhr as any).onabort = (): void => {
      abortFired = true;
    };
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.abort();
    expect(abortFired).toBeTrue();
  });

  it('abort() prevents onload from firing after send() resolves', async () => {
    const xhr = getFakeXhr();
    let loadFired = false;
    xhr.onload = (): void => {
      loadFired = true;
    };
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    xhr.abort();
    await Promise.resolve();
    expect(loadFired).toBeFalse();
  });

  it('abort() prevents onreadystatechange from firing after send() resolves', async () => {
    const xhr = getFakeXhr();
    let rscFired = false;
    xhr.onreadystatechange = (): void => {
      rscFired = true;
    };
    xhr.open('REPORT', 'https://cal.example.com/');
    xhr.send(null);
    xhr.abort();
    await Promise.resolve();
    expect(rscFired).toBeFalse();
  });
});
