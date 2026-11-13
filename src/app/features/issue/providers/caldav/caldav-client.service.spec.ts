import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { CaldavClientService } from './caldav-client.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { CaldavCfg } from './caldav.model';
import { CaldavIssue } from './caldav-issue.model';
import { toBasicAuthHeader } from '../../../../util/to-basic-auth-header';

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

// ─── _mapTask – completion normalization ──────────────────────────────────────

// Regression tests parsing raw VTODO data through the real ical.js: RFC 5545
// lists COMPLETED, STATUS, and PERCENT-COMPLETE as independent optional
// properties, and servers may send any one of them alone to mark a todo done.
describe('CaldavClientService._mapTask – completion normalization', () => {
  const mapTask = (vtodoLines: string[]): Promise<CaldavIssue> =>
    (CaldavClientService as any)._mapTask({
      url: 'https://cal.example.com/task.ics',
      etag: '"etag-1"',
      data: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VTODO',
        'UID:todo-raw-1',
        'SUMMARY:Raw todo',
        ...vtodoLines,
        'END:VTODO',
        'END:VCALENDAR',
      ].join('\r\n'),
    });

  it('should parse a VTODO without completion signals as open', async () => {
    const issue = await mapTask([]);
    expect(issue.completed).toBeFalse();
  });

  it('should treat a COMPLETED timestamp as completed', async () => {
    const issue = await mapTask(['COMPLETED:20260401T120000Z']);
    expect(issue.completed).toBeTrue();
  });

  it('should treat STATUS:COMPLETED without a COMPLETED timestamp as completed', async () => {
    const issue = await mapTask(['STATUS:COMPLETED']);
    expect(issue.completed).toBeTrue();
  });

  it('should treat PERCENT-COMPLETE:100 without STATUS or COMPLETED as completed', async () => {
    const issue = await mapTask(['PERCENT-COMPLETE:100']);
    expect(issue.completed).toBeTrue();
  });

  it('should keep a partially complete in-process VTODO open', async () => {
    const issue = await mapTask(['PERCENT-COMPLETE:50', 'STATUS:IN-PROCESS']);
    expect(issue.completed).toBeFalse();
  });
});

// ─── updateFields$ – completion push dirty-check ──────────────────────────────

describe('CaldavClientService.updateFields$ – completion push', () => {
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

  // The push dirty-check must use the same completion normalization as the
  // poll mapping: with the old COMPLETED-timestamp-only check, reopening a
  // STATUS-only completed todo compared false !== false and never wrote to
  // the server, so the next poll immediately re-completed the local task.
  it('should clear STATUS:COMPLETED when reopening a todo completed via STATUS only', async () => {
    const davTask = {
      data: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VTODO',
        'UID:todo-push-1',
        'SUMMARY:Status only',
        'STATUS:COMPLETED',
        'END:VTODO',
        'END:VCALENDAR',
      ].join('\r\n'),
      url: 'https://cal.example.com/todo-push-1.ics',
      etag: '"etag-1"',
      update: jasmine.createSpy('update').and.resolveTo(undefined),
    };
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: false });
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([davTask]);

    await firstValueFrom(
      svc.updateFields$(MOCK_CFG, 'todo-push-1', { completed: false }),
    );

    expect(davTask.update).toHaveBeenCalled();
    expect(davTask.data).toContain('STATUS:NEEDS-ACTION');
    expect(davTask.data).not.toContain('STATUS:COMPLETED');
  });
});

describe('CaldavClientService.createTask$', () => {
  let svc: CaldavClientService;
  let snack: jasmine.SpyObj<SnackService>;
  const UID = 'sp-todo-task-1@super-productivity';
  const existing = (
    data = 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:' +
      UID +
      '\r\nSUMMARY:Buy milk\r\nEND:VTODO\r\nEND:VCALENDAR',
  ): object => ({
    data,
    url: 'https://cal.example.com/x.ics',
    etag: '"e1"',
  });

  beforeEach(() => {
    snack = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [CaldavClientService, { provide: SnackService, useValue: snack }],
    });
    svc = TestBed.inject(CaldavClientService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('PUTs a VTODO named after its UID without overwriting an existing one', async () => {
    const cal = { readOnly: false, createObject: jasmine.createSpy().and.resolveTo({}) };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([existing()]);

    const issue = await firstValueFrom(
      svc.createTask$(
        { ...MOCK_CFG, categoryFilter: 'work' },
        { uid: UID, summary: 'Buy milk' },
      ),
    );

    const [name, headers, data] = cal.createObject.calls.mostRecent().args;
    expect(name).toBe(encodeURIComponent(UID) + '.ics');
    expect(headers['If-None-Match']).toBe('*');
    expect(data).toContain('BEGIN:VTODO');
    expect(data).toContain('UID:' + UID);
    expect(data).toContain('SUMMARY:Buy milk');
    expect(data).toContain('STATUS:NEEDS-ACTION');
    // without the filter's category the VTODO would vanish from every import
    expect(data).toContain('CATEGORIES:work');
    expect(issue.id).toBe(UID);
  });

  it('writes no CATEGORIES without a category filter', async () => {
    const cal = { readOnly: false, createObject: jasmine.createSpy().and.resolveTo({}) };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([existing()]);

    await firstValueFrom(svc.createTask$(MOCK_CFG, { uid: UID, summary: 'Buy milk' }));

    expect(cal.createObject.calls.mostRecent().args[2]).not.toContain('CATEGORIES');
  });

  it('resolves to the existing VTODO when it was already created (412)', async () => {
    const cal = {
      readOnly: false,
      createObject: jasmine.createSpy().and.rejectWith({ status: 412 }),
    };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([existing()]);

    const issue = await firstValueFrom(
      svc.createTask$(MOCK_CFG, { uid: UID, summary: 'Buy milk' }),
    );

    expect(issue.id).toBe(UID);
    expect(snack.open).not.toHaveBeenCalled();
  });

  it('succeeds when the PUT landed but the follow-up lookup of createObject failed', async () => {
    const cal = {
      readOnly: false,
      createObject: jasmine.createSpy().and.rejectWith({ status: 500 }),
    };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([existing()]);

    const issue = await firstValueFrom(
      svc.createTask$(MOCK_CFG, { uid: UID, summary: 'Buy milk' }),
    );

    expect(issue.id).toBe(UID);
  });

  it('fails when the VTODO is missing after a failed PUT', async () => {
    const cal = {
      readOnly: false,
      createObject: jasmine.createSpy().and.rejectWith({ status: 500 }),
    };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([]);

    await expectAsync(
      firstValueFrom(svc.createTask$(MOCK_CFG, { uid: UID, summary: 'Buy milk' })),
    ).toBeRejected();
    expect(snack.open).toHaveBeenCalled();
  });

  it('refuses to create in a read-only calendar', async () => {
    const cal = { readOnly: true, createObject: jasmine.createSpy() };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);

    await expectAsync(
      firstValueFrom(svc.createTask$(MOCK_CFG, { uid: UID, summary: 'Buy milk' })),
    ).toBeRejected();
    expect(cal.createObject).not.toHaveBeenCalled();
  });
});

describe('CaldavClientService.deleteTask$', () => {
  let svc: CaldavClientService;
  let snack: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    snack = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [CaldavClientService, { provide: SnackService, useValue: snack }],
    });
    svc = TestBed.inject(CaldavClientService);
  });

  afterEach(() => TestBed.resetTestingModule());

  const davTodo = (
    uid: string,
    etag: string,
  ): { data: string; url: string; etag: string; delete: jasmine.Spy } => ({
    data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VTODO',
      `UID:${uid}`,
      'SUMMARY:x',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n'),
    url: `https://cal.example.com/${uid}.ics`,
    etag,
    delete: jasmine.createSpy('delete').and.resolveTo(undefined),
  });

  it('deletes the VTODO guarded by the ETag it just fetched', async () => {
    const davTask = davTodo('todo-del-1', '"etag-1"');
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: false });
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([davTask]);

    await firstValueFrom(svc.deleteTask$(MOCK_CFG, 'todo-del-1'));

    // eslint-disable-next-line @typescript-eslint/naming-convention
    expect(davTask.delete).toHaveBeenCalledOnceWith({ 'If-Match': '"etag-1"' });
  });

  it('deletes only the exact UID, not one the substring UID match also returned', async () => {
    const containing = davTodo('x-todo-del-1-y', '"etag-other"');
    const exact = davTodo('todo-del-1', '"etag-1"');
    // Stubbed at the server answer: the exact-UID filter is part of the lookup.
    spyOn(svc as any, '_getCalendar').and.resolveTo({
      readOnly: false,
      calendarQuery: jasmine
        .createSpy('calendarQuery')
        .and.resolveTo([containing, exact]),
    });

    await firstValueFrom(svc.deleteTask$(MOCK_CFG, 'todo-del-1'));

    expect(containing.delete).not.toHaveBeenCalled();
    expect(exact.delete).toHaveBeenCalledTimes(1);
  });

  it('treats a VTODO that is already gone as deleted, without a snack', async () => {
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: false });
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([]);

    await firstValueFrom(svc.deleteTask$(MOCK_CFG, 'gone'));

    expect(snack.open).not.toHaveBeenCalled();
  });

  it('treats a VTODO deleted between the lookup and the DELETE as deleted', async () => {
    const davTask = davTodo('todo-del-1', '"etag-1"');
    davTask.delete.and.rejectWith({ status: 404 });
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: false });
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([davTask]);

    await firstValueFrom(svc.deleteTask$(MOCK_CFG, 'todo-del-1'), {
      defaultValue: undefined,
    });

    expect(snack.open).not.toHaveBeenCalled();
  });

  it('reports a DELETE that fails for another reason', async () => {
    const davTask = davTodo('todo-del-1', '"etag-1"');
    davTask.delete.and.rejectWith({ status: 412 });
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: false });
    spyOn(CaldavClientService as any, '_findTaskByUid').and.resolveTo([davTask]);

    await expectAsync(
      firstValueFrom(svc.deleteTask$(MOCK_CFG, 'todo-del-1')),
    ).toBeRejected();

    expect(snack.open).toHaveBeenCalled();
  });

  it('refuses to delete from a read-only calendar', async () => {
    const findSpy = spyOn(CaldavClientService as any, '_findTaskByUid');
    spyOn(svc as any, '_getCalendar').and.resolveTo({ readOnly: true });

    await expectAsync(firstValueFrom(svc.deleteTask$(MOCK_CFG, 'x'))).toBeRejected();

    expect(findSpy).not.toHaveBeenCalled();
    expect(snack.open).toHaveBeenCalled();
  });
});

// ─── exact-UID lookup (#11182) ────────────────────────────────────────────────

// The UID text-match is a substring match (RFC 4791 §9.7.5) and some servers
// ignore it and answer with every VTODO of the calendar (Vikunja). These tests
// go through the real lookup: the calendar answers with VTODOs that were not
// asked for, the requested one never first.
describe('CaldavClientService exact-UID lookup', () => {
  let svc: CaldavClientService;
  let snack: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    snack = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [CaldavClientService, { provide: SnackService, useValue: snack }],
    });
    svc = TestBed.inject(CaldavClientService);
  });

  afterEach(() => TestBed.resetTestingModule());

  const davTodo = (
    uid: string,
    summary: string,
  ): { data: string; url: string; etag: string; update: jasmine.Spy } => ({
    data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VTODO',
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      'STATUS:NEEDS-ACTION',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n'),
    url: `https://cal.example.com/${uid}.ics`,
    etag: `"etag-${uid}"`,
    update: jasmine.createSpy('update').and.resolveTo(undefined),
  });

  const mockCalendar = (
    todos: ReturnType<typeof davTodo>[],
  ): { createObject: jasmine.Spy } => {
    const cal = {
      readOnly: false,
      calendarQuery: jasmine.createSpy('calendarQuery').and.resolveTo(todos),
      createObject: jasmine.createSpy('createObject').and.resolveTo(undefined),
    };
    spyOn(svc as any, '_getCalendar').and.resolveTo(cal);
    return cal;
  };

  it('reads the VTODO with the requested UID, not the first one returned', async () => {
    mockCalendar([
      davTodo('other-1', 'Not mine'),
      davTodo('x-todo-1-y', 'Contains the UID'),
      davTodo('todo-1', 'Mine'),
    ]);

    const issue = await firstValueFrom(svc.getById$('todo-1', MOCK_CFG));

    expect(issue?.id).toBe('todo-1');
    expect(issue?.summary).toBe('Mine');
  });

  it('updates the VTODO with the requested UID and leaves the others alone', async () => {
    const other = davTodo('other-1', 'Not mine');
    const mine = davTodo('todo-1', 'Mine');
    mockCalendar([other, mine]);

    await firstValueFrom(svc.updateFields$(MOCK_CFG, 'todo-1', { completed: true }), {
      defaultValue: undefined,
    });

    expect(other.update).not.toHaveBeenCalled();
    expect(other.data).not.toContain('STATUS:COMPLETED');
    expect(mine.update).toHaveBeenCalledTimes(1);
    expect(mine.data).toContain('STATUS:COMPLETED');
  });

  it('does not update any VTODO when none has the requested UID', async () => {
    const other = davTodo('other-1', 'Not mine');
    const containing = davTodo('x-todo-1-y', 'Contains the UID');
    mockCalendar([other, containing]);

    await expectAsync(
      firstValueFrom(svc.updateFields$(MOCK_CFG, 'todo-1', { completed: true })),
    ).toBeRejected();

    expect(other.update).not.toHaveBeenCalled();
    expect(containing.update).not.toHaveBeenCalled();
    expect(other.data).not.toContain('STATUS:COMPLETED');
    expect(containing.data).not.toContain('STATUS:COMPLETED');
  });

  it('returns the created VTODO, not another one the lookup returned', async () => {
    mockCalendar([davTodo('other-1', 'Not mine'), davTodo('todo-1', 'Buy milk')]);

    const issue = await firstValueFrom(
      svc.createTask$(MOCK_CFG, { uid: 'todo-1', summary: 'Buy milk' }),
    );

    expect(issue.id).toBe('todo-1');
    expect(issue.summary).toBe('Buy milk');
  });

  it('fails a create whose VTODO is not among the ones returned', async () => {
    const cal = mockCalendar([davTodo('other-1', 'Not mine')]);
    cal.createObject.and.rejectWith({ status: 500 });

    await expectAsync(
      firstValueFrom(svc.createTask$(MOCK_CFG, { uid: 'todo-1', summary: 'Buy milk' })),
    ).toBeRejected();
  });

  // #11583: a VTODO deleted on the server is an ordinary state, not an error.
  it('resolves null without a snack when no VTODO has the requested UID', async () => {
    mockCalendar([davTodo('other-1', 'Not mine'), davTodo('x-todo-1-y', 'Contains')]);

    const issue = await firstValueFrom(svc.getById$('todo-1', MOCK_CFG));

    expect(issue).toBeNull();
    expect(snack.open).not.toHaveBeenCalled();
  });

  it('resolves null without a snack when the calendar returns nothing', async () => {
    mockCalendar([]);

    const issue = await firstValueFrom(svc.getById$('todo-1', MOCK_CFG));

    expect(issue).toBeNull();
    expect(snack.open).not.toHaveBeenCalled();
  });
});

// ─── shared CalDAV fixtures ───────────────────────────────────────────────────

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

describe('CaldavClientService HTTP helpers (cdav-library v2)', () => {
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

  it('stringifies header values for the native Capacitor HTTP bridge (#11232)', () => {
    const headers = (CaldavClientService as any)._stringifyHeaders({
      Depth: 0,
      Authorization: EXPECTED_AUTH,
    });
    expect(headers['Depth']).toBe('0');
    expect(headers['Authorization']).toBe(EXPECTED_AUTH);
    expect(Object.values(headers).every((v) => typeof v === 'string')).toBeTrue();
  });

  it('synthesizes a DAV feature header when the server/proxy omits it', () => {
    const headers: Record<string, string> = {};
    (CaldavClientService as any)._applyDavHeaderFallback(headers);
    expect(headers['dav']).toBe('1, calendar-access');
  });

  it('leaves an existing DAV header untouched', () => {
    const headers: Record<string, string> = { dav: '1, calendar-access, addressbook' };
    (CaldavClientService as any)._applyDavHeaderFallback(headers);
    expect(headers['dav']).toBe('1, calendar-access, addressbook');
  });

  it('encodes non-ASCII credentials as UTF-8 in Basic auth', () => {
    // printf 'user:pw-€' | base64
    expect(toBasicAuthHeader('user', 'pw-€')).toBe('Basic dXNlcjpwdy3igqw=');
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

// ─── _get_client – real cdav-library connect() ────────────────────────────────

// Regression test for servers (e.g. Rustical) that omit <principal-collection-set>
// from the principal PROPFIND response entirely instead of returning it empty.
// Upstream still reads that prop unguarded (patched in
// patches/@nextcloud+cdav-library+2.8.2.patch); without the patch connect()
// throws and _get_client surfaces a generic CALDAV NETWORK ERROR.
describe('CaldavClientService._get_client', () => {
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

  const CURRENT_USER_PRINCIPAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/caldav/principal/myuser/</href>
    <propstat>
      <prop>
        <current-user-principal>
          <href>/caldav/principal/myuser/</href>
        </current-user-principal>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

  // Mirrors the real Rustical response from the bug report: displayname is
  // returned, but principal-collection-set is only present inside the 404
  // propstat block, so the multistatus parser drops it entirely.
  const PRINCIPAL_PROPS_XML = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/caldav/principal/myuser/</href>
    <propstat>
      <prop>
        <displayname>myuser</displayname>
        <CAL:calendar-user-type>INDIVIDUAL</CAL:calendar-user-type>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
    <propstat>
      <prop>
        <principal-collection-set/>
      </prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
  </response>
</multistatus>`;

  it('connects when the server omits principal-collection-set from the principal response', async () => {
    // v2 connect(): discover PROPFIND, then principal PROPFIND + OPTIONS in parallel.
    svc.webDavRequestSpy.and.callFake(
      async (opts: {
        method: string;
        data?: string;
      }): Promise<{ status: number; headers: Record<string, string>; data: string }> => {
        const method = opts.method.toUpperCase();
        if (method === 'OPTIONS') {
          return {
            status: 200,
            headers: { dav: '1, calendar-access' },
            data: '',
          };
        }
        const body = opts.data ?? '';
        const isDiscover =
          body.includes('current-user-principal') &&
          !body.includes('principal-collection-set');
        return {
          status: 207,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'content-type': 'application/xml' },
          data: isDiscover ? CURRENT_USER_PRINCIPAL_XML : PRINCIPAL_PROPS_XML,
        };
      },
    );

    const clientCache = await (svc as any)._get_client(MOCK_CFG);

    expect(clientCache.client.currentUserPrincipal).toBeTruthy();
    expect(svc.webDavRequestSpy).toHaveBeenCalled();
  });
});

describe('CaldavClientService native axios adapter', () => {
  let svc: TestableCaldavClientService;
  let previousAdapter: unknown;

  beforeEach(async () => {
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
    // @ts-ignore – transitive dep of cdav-library@2
    const axios = (await import('@nextcloud/axios')).default;
    previousAdapter = axios.defaults.adapter;
    await (svc as any)._prepareHttpTransport();
  });

  afterEach(async () => {
    // @ts-ignore
    const axios = (await import('@nextcloud/axios')).default;
    axios.defaults.adapter = previousAdapter as typeof axios.defaults.adapter;
    TestBed.resetTestingModule();
  });

  const runAdapter = async (
    config: Record<string, unknown>,
  ): Promise<{ status: number; data: unknown; headers: Record<string, unknown> }> => {
    const adapter = (svc as any)._createNativeAxiosAdapter();
    return adapter(config);
  };

  it('routes requests through _webDavRequest with auth headers', async () => {
    await runAdapter({
      url: 'https://cal.example.com/',
      method: 'REPORT',
      headers: {
        Authorization: EXPECTED_AUTH,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'X-Requested-With': 'SuperProductivity',
      },
      data: null,
    });
    const callArgs = svc.webDavRequestSpy.calls.mostRecent().args[0];
    expect(callArgs.headers?.['Authorization']).toBe(EXPECTED_AUTH);
    expect(callArgs.headers?.['X-Requested-With']).toBe('SuperProductivity');
  });

  // #11232: cdav-library still sets numeric Depth on some REPORT/PROPFIND calls.
  it('stringifies numeric Depth before calling the Capacitor plugin', async () => {
    await runAdapter({
      url: 'https://cal.example.com/',
      method: 'PROPFIND',
      headers: { Depth: 0 },
      data: '<body/>',
    });
    const callArgs = svc.webDavRequestSpy.calls.mostRecent().args[0];
    expect(callArgs.headers?.['Depth']).toBe('0');
    expect(callArgs.data).toBe('<body/>');
    expect(
      Object.values(callArgs.headers ?? {}).every((v) => typeof v === 'string'),
    ).toBeTrue();
  });

  it('returns status/body from _webDavRequest', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 207,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'application/xml' },
      data: '<multistatus/>',
    });
    const res = await runAdapter({
      url: 'https://cal.example.com/',
      method: 'REPORT',
      headers: {},
    });
    expect(res.status).toBe(207);
    expect(res.data).toBe('<multistatus/>');
  });

  it('synthesizes a DAV header when native HTTP omits it', async () => {
    svc.webDavRequestSpy.and.resolveTo({
      status: 200,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'content-type': 'text/plain' },
      data: '',
    });
    const res = await runAdapter({
      url: 'https://cal.example.com/',
      method: 'OPTIONS',
      headers: {},
    });
    expect(res.headers['dav']).toBe('1, calendar-access');
  });

  it('rejects when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectAsync(
      runAdapter({
        url: 'https://cal.example.com/',
        method: 'GET',
        headers: {},
        signal: controller.signal,
      }),
    ).toBeRejected();
  });
});
