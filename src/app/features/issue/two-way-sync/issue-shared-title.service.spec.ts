import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { IssueSharedTitleService } from './issue-shared-title.service';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { IssueProviderService } from '../issue-provider.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from './issue-sync.model';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

describe('IssueSharedTitleService', () => {
  let service: IssueSharedTitleService;
  let syncConfig: FieldSyncConfig;
  let adapter: IssueSyncAdapter<unknown> | undefined;

  const titleMapping = {
    taskField: 'title',
    issueField: 'summary',
    defaultDirection: 'both',
    toIssueValue: (v: unknown) => v,
    toTaskValue: (v: unknown) => v,
  } as FieldMapping;
  const linked = (overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id: 't1',
      title: 'Fix bugs #123',
      issueId: 'item-1',
      issueType: 'PLAINSPACE',
      issueProviderId: 'provider-1',
      issueLastSyncedValues: { summary: 'Fix bug #123' },
      ...overrides,
    }) as Task;

  beforeEach(() => {
    syncConfig = {};
    adapter = {
      getFieldMappings: () => [titleMapping],
      getSyncConfig: () => syncConfig,
    } as unknown as IssueSyncAdapter<unknown>;
    TestBed.configureTestingModule({
      providers: [
        IssueSharedTitleService,
        {
          provide: IssueSyncAdapterResolverService,
          useValue: { getAdapter: () => adapter },
        },
        { provide: IssueProviderService, useValue: { getCfgOnce$: () => of({}) } },
      ],
    });
    service = TestBed.inject(IssueSharedTitleService);
  });

  it('is the baseline title when the title syncs both ways', async () => {
    expect(await service.getSharedTitle(linked())).toBe('Fix bug #123');
  });

  it('is undefined when the provider config narrows the title', async () => {
    syncConfig = { title: 'pullOnly' };
    expect(await service.getSharedTitle(linked())).toBeUndefined();
  });

  it('is undefined for an unlinked task, a provider without a title mapping, or no baseline', async () => {
    expect(await service.getSharedTitle(linked({ issueId: undefined }))).toBeUndefined();
    expect(
      await service.getSharedTitle(linked({ issueLastSyncedValues: {} })),
    ).toBeUndefined();
    adapter = undefined;
    expect(await service.getSharedTitle(linked())).toBeUndefined();
  });
});
