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

  beforeEach(() => {
    api = jasmine.createSpyObj('PlainspaceApiService', ['getById$', 'patchTask$']);
    TestBed.configureTestingModule({
      providers: [
        PlainspaceSyncAdapterService,
        { provide: PlainspaceApiService, useValue: api },
      ],
    });
    adapter = TestBed.inject(PlainspaceSyncAdapterService);
  });

  it('maps isDone, title and dueWithTime, all push-only', () => {
    expect(adapter.getSyncConfig(cfg)).toEqual({
      isDone: 'pushOnly',
      title: 'pushOnly',
      dueWithTime: 'pushOnly',
    });
    const mappings = adapter.getFieldMappings();
    expect(mappings.map((m) => [m.taskField, m.issueField])).toEqual([
      ['isDone', 'isDone'],
      ['title', 'title'],
      ['dueWithTime', 'scheduledAt'],
    ]);
    expect(mappings.every((m) => m.defaultDirection === 'pushOnly')).toBe(true);
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

  it('pushChanges PATCHes the done state', async () => {
    api.patchTask$.and.returnValue(of(null));
    await adapter.pushChanges('t1', { isDone: true }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { done: true }, cfg);
  });

  it('pushChanges PATCHes a renamed title', async () => {
    api.patchTask$.and.returnValue(of(null));
    await adapter.pushChanges('t1', { title: 'New name' }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { title: 'New name' }, cfg);
  });

  it('pushChanges PATCHes scheduledAt, including null to unschedule', async () => {
    api.patchTask$.and.returnValue(of(null));
    await adapter.pushChanges('t1', { scheduledAt: '2026-01-02T09:00:00.000Z' }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith(
      't1',
      { scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
    api.patchTask$.calls.reset();
    await adapter.pushChanges('t1', { scheduledAt: null }, cfg);
    expect(api.patchTask$).toHaveBeenCalledWith('t1', { scheduledAt: null }, cfg);
  });

  it('pushChanges collapses done + scheduledAt into a single PATCH', async () => {
    api.patchTask$.and.returnValue(of(null));
    await adapter.pushChanges(
      't1',
      { isDone: true, scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
    expect(api.patchTask$).toHaveBeenCalledTimes(1);
    expect(api.patchTask$).toHaveBeenCalledWith(
      't1',
      { done: true, scheduledAt: '2026-01-02T09:00:00.000Z' },
      cfg,
    );
  });

  it('pushChanges does nothing when no mapped field is in the changes', async () => {
    await adapter.pushChanges('t1', { notes: 'x' }, cfg);
    expect(api.patchTask$).not.toHaveBeenCalled();
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

  it('extractSyncValues exposes isDone, title and scheduledAt (baseline)', () => {
    expect(
      adapter.extractSyncValues({
        isDone: true,
        title: 'x',
        scheduledAt: '2026-01-02T09:00:00.000Z',
        url: 'ignored',
      }),
    ).toEqual({ isDone: true, title: 'x', scheduledAt: '2026-01-02T09:00:00.000Z' });
  });

  it('getIssueLastUpdated parses updatedAt, or 0 when absent', () => {
    expect(adapter.getIssueLastUpdated({ updatedAt: '2026-01-02T00:00:00.000Z' })).toBe(
      new Date('2026-01-02T00:00:00.000Z').getTime(),
    );
    expect(adapter.getIssueLastUpdated({})).toBe(0);
  });
});
