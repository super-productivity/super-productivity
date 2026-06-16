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
    api = jasmine.createSpyObj('PlainspaceApiService', ['getById$', 'setTaskDone$']);
    TestBed.configureTestingModule({
      providers: [
        PlainspaceSyncAdapterService,
        { provide: PlainspaceApiService, useValue: api },
      ],
    });
    adapter = TestBed.inject(PlainspaceSyncAdapterService);
  });

  it('maps only isDone, push-only', () => {
    expect(adapter.getSyncConfig(cfg)).toEqual({ isDone: 'pushOnly' });
    const mappings = adapter.getFieldMappings();
    expect(mappings.length).toBe(1);
    expect(mappings[0].taskField).toBe('isDone');
    expect(mappings[0].issueField).toBe('isDone');
    expect(mappings[0].defaultDirection).toBe('pushOnly');
  });

  it('pushChanges PATCHes the done state', async () => {
    api.setTaskDone$.and.returnValue(of(null));
    await adapter.pushChanges('t1', { isDone: true }, cfg);
    expect(api.setTaskDone$).toHaveBeenCalledWith('t1', true, cfg);
  });

  it('pushChanges does nothing when isDone is not in the changes', async () => {
    await adapter.pushChanges('t1', { title: 'x' }, cfg);
    expect(api.setTaskDone$).not.toHaveBeenCalled();
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
      }),
    );
    expect(await adapter.fetchIssue('t1', cfg)).toEqual(
      jasmine.objectContaining({ isDone: true }),
    );

    api.getById$.and.returnValue(of(null));
    expect(await adapter.fetchIssue('missing', cfg)).toEqual({});
  });

  it('extractSyncValues exposes isDone', () => {
    expect(adapter.extractSyncValues({ isDone: true, title: 'x' })).toEqual({
      isDone: true,
    });
  });

  it('getIssueLastUpdated parses updatedAt, or 0 when absent', () => {
    expect(adapter.getIssueLastUpdated({ updatedAt: '2026-01-02T00:00:00.000Z' })).toBe(
      new Date('2026-01-02T00:00:00.000Z').getTime(),
    );
    expect(adapter.getIssueLastUpdated({})).toBe(0);
  });
});
