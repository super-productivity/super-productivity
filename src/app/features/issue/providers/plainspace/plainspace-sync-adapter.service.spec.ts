import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlainspaceSyncAdapterService } from './plainspace-sync-adapter.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';
import { DEFAULT_PLAINSPACE_CFG } from './plainspace-cfg-form.const';

describe('PlainspaceSyncAdapterService', () => {
  let adapter: PlainspaceSyncAdapterService;
  let api: jasmine.SpyObj<PlainspaceApiService>;

  const cfg: PlainspaceCfg = {
    ...DEFAULT_PLAINSPACE_CFG,
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
    ]);
    TestBed.configureTestingModule({
      providers: [
        PlainspaceSyncAdapterService,
        { provide: PlainspaceApiService, useValue: api },
      ],
    });
    adapter = TestBed.inject(PlainspaceSyncAdapterService);
  });

  it('pushes completion but only pulls title and schedule', () => {
    expect(adapter.getSyncConfig(cfg)).toEqual({
      isDone: 'pushOnly',
      title: 'pullOnly',
      dueWithTime: 'pullOnly',
    });
    const mappings = adapter.getFieldMappings();
    expect(mappings.map((m) => [m.taskField, m.issueField])).toEqual([
      ['isDone', 'isDone'],
      ['title', 'title'],
      ['dueWithTime', 'scheduledAt'],
    ]);
    expect(mappings.map((m) => m.defaultDirection)).toEqual([
      'pushOnly',
      'pullOnly',
      'pullOnly',
    ]);
  });

  it('dueWithTime <-> scheduledAt maps epoch-ms to ISO and back', () => {
    const m = adapter.getFieldMappings().find((x) => x.taskField === 'dueWithTime')!;
    const ms = Date.UTC(2026, 0, 2, 9, 0, 0);
    expect(m.toIssueValue(ms, { issueId: 't1' })).toBe('2026-01-02T09:00:00.000Z');
    expect(m.toTaskValue('2026-01-02T09:00:00.000Z', { issueId: 't1' })).toBe(ms);
    // unschedule / absent -> null / undefined
    expect(m.toIssueValue(undefined, { issueId: 't1' })).toBeNull();
    expect(m.toTaskValue(null, { issueId: 't1' })).toBeUndefined();
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

  it('pushChanges ignores local title and schedule changes', async () => {
    await adapter.pushChanges(
      't1',
      { title: 'New name', scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
    expect(api.patchTask$).not.toHaveBeenCalled();
  });

  it('pushChanges omits pull-only fields when completion changes too', async () => {
    api.patchTask$.and.returnValue(of(patchedIssue));
    await adapter.pushChanges(
      't1',
      {
        isDone: true,
        title: 'New name',
        scheduledAt: '2026-01-02T09:00:00.000Z',
      },
      cfg,
    );
    expect(api.patchTask$).toHaveBeenCalledTimes(1);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { done: true }, cfg);
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

  it('pushChanges does nothing when no mapped field is in the changes', async () => {
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
