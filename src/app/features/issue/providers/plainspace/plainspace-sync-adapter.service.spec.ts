import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PlainspaceSyncAdapterService } from './plainspace-sync-adapter.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';
import { DEFAULT_PLAINSPACE_CFG } from './plainspace-cfg-form.const';
import { PlainspaceConnectionStateService } from './plainspace-connection-state.service';
import { IssueSyncPushError } from '../../two-way-sync/issue-sync.model';
import { T } from '../../../../t.const';
import { computePushDecisions } from '../../two-way-sync/compute-push-decisions';

const httpError = (status: number, error: unknown = {}): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

describe('PlainspaceSyncAdapterService', () => {
  let adapter: PlainspaceSyncAdapterService;
  let api: jasmine.SpyObj<PlainspaceApiService>;
  let connectionState: PlainspaceConnectionStateService;

  const cfg: PlainspaceCfg & { id: string } = {
    ...DEFAULT_PLAINSPACE_CFG,
    id: 'provider-1',
    host: 'https://plainspace.org',
    spaceId: 'space-1',
    token: 'pat_x',
  };
  const patchedIssue = {
    id: 't1',
    isDone: true,
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('PlainspaceApiService', [
      'getById$',
      'patchTask$',
      'createTask$',
      'deleteTask$',
    ]);
    TestBed.configureTestingModule({
      providers: [
        PlainspaceSyncAdapterService,
        { provide: PlainspaceApiService, useValue: api },
      ],
    });
    adapter = TestBed.inject(PlainspaceSyncAdapterService);
    connectionState = TestBed.inject(PlainspaceConnectionStateService);
  });

  it('syncs completion, title and the scheduled time both ways', () => {
    expect(adapter.getSyncConfig(cfg)).toEqual({
      isDone: 'both',
      title: 'both',
      dueWithTime: 'both',
      dueDay: 'pushOnly',
    });
    const mappings = adapter.getFieldMappings();
    // The time comes before the day-only plan: the first mapping of a remote
    // field decides it.
    expect(mappings.map((m) => [m.taskField, m.issueField])).toEqual([
      ['isDone', 'isDone'],
      ['title', 'title'],
      ['dueWithTime', 'scheduledAt'],
      ['dueDay', 'scheduledAt'],
    ]);
  });

  it('a plan without a time sends "no time" and never pulls a day', () => {
    const m = adapter.getFieldMappings().find((x) => x.taskField === 'dueDay')!;
    expect(m.toIssueValue('2026-01-02', { issueId: 't1' })).toBeNull();
    expect(m.toIssueValue(undefined, { issueId: 't1' })).toBeNull();
    expect(m.toTaskValue('2026-01-02T09:00:00.000Z', { issueId: 't1' })).toBeUndefined();
  });

  it('decides the remote time from the task: its time, else "no time"', () => {
    const at = '2026-01-02T09:00:00.000Z';
    const decide = (
      changes: Record<string, unknown>,
      config = adapter.getSyncConfig(cfg),
    ): unknown[] =>
      computePushDecisions(
        changes,
        adapter.getFieldMappings(),
        config,
        { scheduledAt: at },
        { scheduledAt: at },
        { issueId: 't1' },
      )
        .filter((d) => d.action === 'push')
        .map((d) => [d.field, d.action, d.issueValue]);
    // Planning a day reports the day alone.
    expect(decide({ dueDay: '2026-01-03' })).toEqual([['scheduledAt', 'push', null]]);
    // A time wins over a day reported with it.
    expect(
      decide({ dueWithTime: Date.parse('2026-01-04T10:00:00.000Z'), dueDay: undefined }),
    ).toEqual([['scheduledAt', 'push', '2026-01-04T10:00:00.000Z']]);
    expect(decide({ dueWithTime: undefined })).toEqual([['scheduledAt', 'push', null]]);
    // A repeating item's time is never sent.
    expect(
      decide({ dueDay: '2026-01-03' }, adapter.getSyncConfig(cfg, { isRecurring: true })),
    ).toEqual([]);
  });

  it("keeps a repeating item's time pull only", () => {
    expect(adapter.getSyncConfig(cfg, { isRecurring: true })).toEqual({
      isDone: 'both',
      title: 'both',
      dueWithTime: 'pullOnly',
      dueDay: 'off',
    });
    expect(adapter.getSyncConfig(cfg, { isRecurring: false }).dueWithTime).toBe('both');
  });

  it('keeps title and time pull-only for a provider whose server is too old', () => {
    connectionState.reportServerTooOld('provider-1');
    expect(adapter.getSyncConfig(cfg)).toEqual({
      isDone: 'both',
      title: 'pullOnly',
      dueWithTime: 'pullOnly',
      dueDay: 'off',
    });
    const otherCfg: PlainspaceCfg & { id: string } = { ...cfg, id: 'provider-2' };
    expect(adapter.getSyncConfig(otherCfg).title).toBe('both');
  });

  it('dueWithTime <-> scheduledAt maps epoch-ms to ISO and back', () => {
    const m = adapter.getFieldMappings().find((x) => x.taskField === 'dueWithTime')!;
    const ms = Date.UTC(2026, 0, 2, 9, 0, 0);
    expect(m.toIssueValue(ms, { issueId: 't1' })).toBe('2026-01-02T09:00:00.000Z');
    expect(m.toTaskValue('2026-01-02T09:00:00.000Z', { issueId: 't1' })).toBe(ms);
    // unschedule / absent -> null / undefined
    expect(m.toIssueValue(undefined, { issueId: 't1' })).toBeNull();
    expect(m.toTaskValue(null, { issueId: 't1' })).toBeNull();
  });

  it('pushChanges PATCHes only the completion state for complete and reopen', async () => {
    api.patchTask$.and.returnValue(of(patchedIssue));
    await adapter.pushChanges('t1', { isDone: true }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { done: true }, cfg);

    api.patchTask$.calls.reset();
    api.patchTask$.and.returnValue(of({ ...patchedIssue, isDone: false }));
    await adapter.pushChanges('t1', { isDone: false }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { done: false }, cfg);
  });

  it('pushChanges sends the title verbatim and the scheduled time', async () => {
    api.patchTask$.and.returnValue(
      of({
        ...patchedIssue,
        title: ' New name ',
        scheduledAt: '2026-01-02T09:00:00.000Z',
      }),
    );
    await adapter.pushChanges(
      't1',
      { isDone: true, title: ' New name ', scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
    expect(api.patchTask$).toHaveBeenCalledOnceWith(
      't1',
      { done: true, title: ' New name ', scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
  });

  it('pushChanges sends "no time" as null', async () => {
    api.patchTask$.and.returnValue(of({ ...patchedIssue, scheduledAt: null }));
    await adapter.pushChanges('t1', { scheduledAt: null }, cfg);
    expect(api.patchTask$).toHaveBeenCalledOnceWith('t1', { scheduledAt: null }, cfg);
    expect(connectionState.isServerTooOld('provider-1')).toBeFalse();
  });

  it('compares the time echo as an instant: the server answers UTC', async () => {
    api.patchTask$.and.returnValue(
      of({ ...patchedIssue, scheduledAt: '2026-01-02T08:00:00.000Z' }),
    );
    await adapter.pushChanges(
      't1',
      { scheduledAt: '2026-01-02T09:00:00.000+01:00' },
      cfg,
    );
    expect(connectionState.isServerTooOld('provider-1')).toBeFalse();
  });

  it('a time the server ignores or leaves out marks it too old', async () => {
    api.patchTask$.and.returnValue(of({ ...patchedIssue, scheduledAt: null }));
    await expectAsync(
      adapter.pushChanges('t1', { scheduledAt: '2026-01-02T09:00:00.000Z' }, cfg),
    ).toBeRejectedWith(jasmine.objectContaining({ isExpectedSyncSkip: true }));
    expect(connectionState.isServerTooOld('provider-1')).toBeTrue();
  });

  it('a 422 on a time marks the server too old, sends done alone and skips quietly', async () => {
    api.patchTask$.and.returnValues(
      throwError(() => httpError(422)),
      of(patchedIssue),
    );
    await expectAsync(
      adapter.pushChanges('t1', { isDone: true, scheduledAt: null }, cfg),
    ).toBeRejectedWith(jasmine.objectContaining({ isExpectedSyncSkip: true }));
    expect(api.patchTask$.calls.allArgs()).toEqual([
      ['t1', { done: true, scheduledAt: null }, cfg],
      ['t1', { done: true }, cfg],
    ]);
    expect(connectionState.isServerTooOld('provider-1')).toBeTrue();
  });

  it('a 409 is a refusal of this change, never an old server', async () => {
    api.patchTask$.and.returnValue(
      throwError(() => httpError(409, { error: 'repeat_requires_remind_at' })),
    );
    await expectAsync(
      adapter.pushChanges('t1', { scheduledAt: null }, cfg),
    ).toBeRejectedWith(new IssueSyncPushError(T.PLAINSPACE.SYNC.ERR_REPEAT_NEEDS_TIME));

    api.patchTask$.and.returnValue(throwError(() => httpError(409, { error: 'other' })));
    await expectAsync(
      adapter.pushChanges('t1', { title: 'New name' }, cfg),
    ).toBeRejectedWith(new IssueSyncPushError(T.PLAINSPACE.SYNC.ERR_REFUSED));
    expect(connectionState.isServerTooOld('provider-1')).toBeFalse();
  });

  it('pushChanges resolves to the written updatedAt, the marker of its own write', async () => {
    api.patchTask$.and.returnValue(
      of({ ...patchedIssue, updatedAt: '2026-01-02T00:00:00.000Z' }),
    );
    expect(await adapter.pushChanges('t1', { isDone: true }, cfg)).toEqual({
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    api.patchTask$.and.returnValue(of(patchedIssue));
    expect(await adapter.pushChanges('t1', { isDone: true }, cfg)).toBeUndefined();
  });

  it('pushChanges compares the echo exactly: a title that differs even by whitespace counts as not taken', async () => {
    // The server stores titles verbatim, so a different echo means it ignored
    // the field: an older server. Titles stop for this provider's session.
    api.patchTask$.and.returnValue(of({ ...patchedIssue, title: 'New name' }));
    await expectAsync(
      adapter.pushChanges('t1', { title: 'New name ' }, cfg),
    ).toBeRejectedWith(jasmine.objectContaining({ isExpectedSyncSkip: true }));
    expect(connectionState.isServerTooOld('provider-1')).toBeTrue();
    expect(adapter.getSyncConfig(cfg).title).toBe('pullOnly');
  });

  it('pushChanges refuses a blank or over-long title without a request', async () => {
    await expectAsync(adapter.pushChanges('t1', { title: '   ' }, cfg)).toBeRejectedWith(
      new IssueSyncPushError(T.PLAINSPACE.SYNC.ERR_TITLE_EMPTY),
    );
    await expectAsync(
      adapter.pushChanges('t1', { title: 'x'.repeat(501) }, cfg),
    ).toBeRejectedWith(new IssueSyncPushError(T.PLAINSPACE.SYNC.ERR_TITLE_TOO_LONG));
    expect(api.patchTask$).not.toHaveBeenCalled();

    api.patchTask$.and.returnValue(of({ ...patchedIssue, title: 'x'.repeat(500) }));
    await adapter.pushChanges('t1', { title: 'x'.repeat(500) }, cfg);
    expect(api.patchTask$).toHaveBeenCalledTimes(1);
  });

  it('pushChanges still sends done next to a title it refuses, then reports the title', async () => {
    api.patchTask$.and.returnValue(of(patchedIssue));
    await expectAsync(
      adapter.pushChanges('t1', { isDone: true, title: 'x'.repeat(501) }, cfg),
    ).toBeRejectedWith(new IssueSyncPushError(T.PLAINSPACE.SYNC.ERR_TITLE_TOO_LONG));
    expect(api.patchTask$).toHaveBeenCalledOnceWith('t1', { done: true }, cfg);
    expect(connectionState.isServerTooOld('provider-1')).toBe(false);
  });

  it('a 422 on a title marks the server too old, sends done alone and skips quietly', async () => {
    api.patchTask$.and.returnValues(
      throwError(() => httpError(422)),
      of(patchedIssue),
    );
    await expectAsync(
      adapter.pushChanges('t1', { isDone: true, title: 'New name' }, cfg),
    ).toBeRejectedWith(jasmine.objectContaining({ isExpectedSyncSkip: true }));
    expect(api.patchTask$.calls.allArgs()).toEqual([
      ['t1', { done: true, title: 'New name' }, cfg],
      ['t1', { done: true }, cfg],
    ]);
    expect(connectionState.isServerTooOld('provider-1')).toBeTrue();
  });

  it('a title the server ignores marks it too old without a second request', async () => {
    api.patchTask$.and.returnValue(of({ ...patchedIssue, title: 'Old name' }));
    await expectAsync(
      adapter.pushChanges('t1', { isDone: true, title: 'New name' }, cfg),
    ).toBeRejectedWith(jasmine.objectContaining({ isExpectedSyncSkip: true }));
    expect(api.patchTask$).toHaveBeenCalledTimes(1);
    expect(connectionState.isServerTooOld('provider-1')).toBeTrue();
  });

  it('a 422 on done alone is an ordinary failure', async () => {
    api.patchTask$.and.returnValue(throwError(() => httpError(422)));
    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejectedWith(
      jasmine.objectContaining({ status: 422 }),
    );
    expect(connectionState.isServerTooOld('provider-1')).toBeFalse();
  });

  // Review finding: only the poll reported a rejected token, so "reconnect"
  // waited for it after a push had already failed.
  it('a rejected token on a push or fetch shows "reconnect" at once', async () => {
    api.patchTask$.and.returnValue(throwError(() => httpError(401)));
    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejected();
    expect(connectionState.rejectedProviderIds().has('provider-1')).toBeTrue();

    connectionState.clear(['provider-1']);
    api.getById$.and.returnValue(throwError(() => httpError(401)));
    await expectAsync(adapter.fetchIssue('t1', cfg)).toBeRejected();
    expect(connectionState.rejectedProviderIds().has('provider-1')).toBeTrue();
  });

  it('an offline push or fetch says nothing about the token', async () => {
    api.patchTask$.and.returnValue(throwError(() => httpError(0)));
    api.getById$.and.returnValue(throwError(() => httpError(0)));
    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejected();
    await expectAsync(adapter.fetchIssue('t1', cfg)).toBeRejected();
    expect(connectionState.rejectedProviderIds().size).toBe(0);
  });

  it('pushChanges rejects a failed completion PATCH', async () => {
    api.patchTask$.and.returnValue(of(null));

    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejected();
  });

  it('pushChanges rejects a response that does not confirm completion', async () => {
    api.patchTask$.and.returnValue(of({ ...patchedIssue, isDone: false }));

    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejected();
  });

  it('pushChanges rejects a response for a different task', async () => {
    api.patchTask$.and.returnValue(of({ ...patchedIssue, id: 'other' }));

    await expectAsync(adapter.pushChanges('t1', { isDone: true }, cfg)).toBeRejected();
  });

  it('pushChanges does nothing when no pushed field is in the changes', async () => {
    await adapter.pushChanges('t1', { notes: 'x' }, cfg);
    expect(api.patchTask$).not.toHaveBeenCalled();
  });

  it('createIssue creates the task and returns id + baseline-seeding issueData', async () => {
    const created = {
      id: 'new-1',
      title: 'Buy milk',
      isDone: false,
      updatedAt: '2026-01-02T00:00:00.000Z',
      url: 'https://plainspace.org/p/item/new-1',
      projectId: 'space-1',
      scheduledAt: null,
      isRecurring: false,
    };
    api.createTask$.and.returnValue(of(created));

    const res = await adapter.createIssue('Buy milk', cfg);

    expect(api.createTask$).toHaveBeenCalledWith('Buy milk', cfg);
    expect(res.issueId).toBe('new-1');
    // issueData must carry the fields extractSyncValues reads, so the effect can
    // seed the two-way-sync baseline (else the first push is dropped).
    expect(adapter.extractSyncValues(res.issueData)).toEqual({
      isDone: false,
      title: 'Buy milk',
      scheduledAt: null,
    });
    // No numeric issue number -> the SP title keeps no '#123' prefix.
    expect((res as { issueNumber?: number }).issueNumber).toBeUndefined();
  });

  it('deleteIssue deletes the task in Plainspace', async () => {
    api.deleteTask$.and.returnValue(of(undefined));
    await adapter.deleteIssue('t1', cfg);
    expect(api.deleteTask$).toHaveBeenCalledWith('t1', cfg);
  });

  it('deleteIssue rejects when the delete fails', async () => {
    api.deleteTask$.and.returnValue(throwError(() => new Error('boom')));
    await expectAsync(adapter.deleteIssue('t1', cfg)).toBeRejected();
  });

  it('fetchIssue returns the issue, or {} when it is missing', async () => {
    api.getById$.and.returnValue(
      of({
        id: 't1',
        title: 'T',
        isDone: true,
        updatedAt: '2026-01-02T00:00:00.000Z',
        url: 'u',
        projectId: 'space-1',
        scheduledAt: null,
        isRecurring: false,
      }),
    );
    expect(await adapter.fetchIssue('t1', cfg)).toEqual(
      jasmine.objectContaining({ isDone: true }),
    );

    api.getById$.and.returnValue(of(null));
    expect(await adapter.fetchIssue('missing', cfg)).toEqual({});
  });

  it('extractSyncValues includes completion and pulled field baselines', () => {
    expect(
      adapter.extractSyncValues({
        isDone: true,
        title: 'x',
        scheduledAt: '2026-01-02T09:00:00.000Z',
      }),
    ).toEqual({
      isDone: true,
      title: 'x',
      scheduledAt: '2026-01-02T09:00:00.000Z',
    });
  });

  it('getIssueLastUpdated parses updatedAt, or 0 when absent', () => {
    expect(adapter.getIssueLastUpdated({ updatedAt: '2026-01-02T00:00:00.000Z' })).toBe(
      new Date('2026-01-02T00:00:00.000Z').getTime(),
    );
    expect(adapter.getIssueLastUpdated({})).toBe(0);
  });
});
