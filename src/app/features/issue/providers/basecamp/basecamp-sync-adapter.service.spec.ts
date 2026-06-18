import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BasecampSyncAdapterService } from './basecamp-sync-adapter.service';
import { BasecampApiService } from './basecamp-api.service';
import { BasecampCfg } from './basecamp.model';
import { DEFAULT_BASECAMP_CFG } from './basecamp-cfg-form.const';
import { computePushDecisions } from '../../two-way-sync/compute-push-decisions';

describe('BasecampSyncAdapterService', () => {
  let service: BasecampSyncAdapterService;
  let api: jasmine.SpyObj<BasecampApiService>;

  const cfg: BasecampCfg = {
    ...DEFAULT_BASECAMP_CFG,
    isEnabled: true,
    accessToken: 'token',
    accountId: '123456',
    bucketId: '654321',
    todolistId: '777',
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<BasecampApiService>('BasecampApiService', [
      'getTodo$',
      'completeTodo$',
      'uncompleteTodo$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        BasecampSyncAdapterService,
        {
          provide: BasecampApiService,
          useValue: api,
        },
      ],
    });

    service = TestBed.inject(BasecampSyncAdapterService);
  });

  it('getFieldMappings() returns exactly one mapping with taskField isDone, issueField completed, defaultDirection pushOnly', () => {
    const mappings = service.getFieldMappings();

    expect(mappings.length).toBe(1);
    expect(mappings[0].taskField).toBe('isDone');
    expect(mappings[0].issueField).toBe('completed');
    expect(mappings[0].defaultDirection).toBe('pushOnly');
  });

  it('getSyncConfig(cfg) returns {} (empty object)', () => {
    const syncConfig = service.getSyncConfig(cfg);

    expect(syncConfig).toEqual({});
  });

  it('pushChanges with completed true calls completeTodo$', async () => {
    api.completeTodo$.and.returnValue(of(undefined));

    await service.pushChanges('42', { completed: true }, cfg);

    expect(api.completeTodo$).toHaveBeenCalledWith('42', cfg);
    expect(api.uncompleteTodo$).not.toHaveBeenCalled();
  });

  it('pushChanges with completed false calls uncompleteTodo$', async () => {
    api.uncompleteTodo$.and.returnValue(of(undefined));

    await service.pushChanges('42', { completed: false }, cfg);

    expect(api.uncompleteTodo$).toHaveBeenCalledWith('42', cfg);
    expect(api.completeTodo$).not.toHaveBeenCalled();
  });

  it('pushChanges with no completed field calls neither completeTodo$ nor uncompleteTodo$', async () => {
    await service.pushChanges('42', {}, cfg);

    expect(api.completeTodo$).not.toHaveBeenCalled();
    expect(api.uncompleteTodo$).not.toHaveBeenCalled();
  });

  it('extractSyncValues({ completed: true }) returns { completed: true }', () => {
    const result = service.extractSyncValues({ completed: true });

    expect(result).toEqual({ completed: true });
  });

  it('getIssueLastUpdated with updated_at returns correct timestamp', () => {
    const timestamp = new Date('2026-06-17T11:00:00Z').getTime();
    const result = service.getIssueLastUpdated({ updated_at: '2026-06-17T11:00:00Z' });

    expect(result).toBe(timestamp);
  });

  it('getIssueLastUpdated with created_at returns correct timestamp', () => {
    const timestamp = new Date('2026-06-17T09:00:00Z').getTime();
    const result = service.getIssueLastUpdated({ created_at: '2026-06-17T09:00:00Z' });

    expect(result).toBe(timestamp);
  });

  it('getIssueLastUpdated with no dates returns 0', () => {
    const result = service.getIssueLastUpdated({});

    expect(result).toBe(0);
  });

  it('fetchIssue calls getTodo$ and resolves with the result', async () => {
    const todo = { id: 42, content: 'x', completed: false };
    api.getTodo$.and.returnValue(of(todo));

    const result = await service.fetchIssue('42', cfg);

    expect(api.getTodo$).toHaveBeenCalledWith('42', cfg);
    expect(result.id).toBe(42);
  });

  it('computePushDecisions with changedTaskFields {isDone:true}, fresh {completed:false}, baseline {completed:false} => action push', async () => {
    const mappings = service.getFieldMappings();
    const syncConfig = service.getSyncConfig(cfg);
    const ctx = { issueId: '42', issueNumber: 42 };

    const decisions = computePushDecisions(
      { isDone: true },
      mappings,
      syncConfig,
      { completed: false },
      { completed: false },
      ctx,
    );

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe('push');
    expect(decisions[0].issueValue).toBe(true);
  });

  it('computePushDecisions with provider-changed skips', async () => {
    const mappings = service.getFieldMappings();
    const syncConfig = service.getSyncConfig(cfg);
    const ctx = { issueId: '42', issueNumber: 42 };

    const decisions = computePushDecisions(
      { isDone: true },
      mappings,
      syncConfig,
      { completed: true },
      { completed: false },
      ctx,
    );

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe('skip');
    expect(decisions[0].reasonCode).toBe('provider-changed');
  });

  it('computePushDecisions with no-baseline skips', async () => {
    const mappings = service.getFieldMappings();
    const syncConfig = service.getSyncConfig(cfg);
    const ctx = { issueId: '42', issueNumber: 42 };

    const decisions = computePushDecisions(
      { isDone: true },
      mappings,
      syncConfig,
      { completed: false },
      {},
      ctx,
    );

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe('skip');
    expect(decisions[0].reasonCode).toBe('no-baseline');
  });
});
