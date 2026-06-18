import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { IssueProviderService } from '../../issue-provider.service';
import { BasecampApiService } from './basecamp-api.service';
import { BasecampCommonInterfacesService } from './basecamp-common-interfaces.service';
import { DEFAULT_BASECAMP_CFG } from './basecamp-cfg-form.const';
import { BasecampTodo } from './basecamp-issue.model';
import { BasecampCfg } from './basecamp.model';
import { Task } from '../../../tasks/task.model';

describe('BasecampCommonInterfacesService', () => {
  let service: BasecampCommonInterfacesService;
  let api: jasmine.SpyObj<BasecampApiService>;

  const cfg: BasecampCfg = {
    ...DEFAULT_BASECAMP_CFG,
    isEnabled: true,
    accessToken: 'token',
    accountId: '123456',
    bucketId: '654321',
    todolistId: '777',
  };

  const createTodo = (overrides: Partial<BasecampTodo> = {}): BasecampTodo =>
    ({
      id: 42,
      content: 'Follow up with client',
      completed: false,
      description: 'Bring the updated estimate',
      due_on: '2026-06-20',
      updated_at: '2026-06-17T10:15:00Z',
      created_at: '2026-06-17T09:00:00Z',
      ...overrides,
    }) as BasecampTodo;

  const createTask = (overrides: Record<string, unknown> = {}): Task =>
    ({
      id: 'task-1',
      title: 'Follow up with client',
      issueId: '42',
      issueProviderId: 'provider-1',
      issueType: 'BASECAMP',
      issueLastUpdated: new Date('2026-06-17T10:15:00Z').getTime(),
      issueWasUpdated: false,
      isDone: false,
      dueDay: '2026-06-20',
      ...overrides,
    }) as unknown as Task;

  beforeEach(() => {
    api = jasmine.createSpyObj<BasecampApiService>('BasecampApiService', [
      'getTodolist$',
      'listTodos$',
      'getTodo$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        BasecampCommonInterfacesService,
        {
          provide: BasecampApiService,
          useValue: api,
        },
        {
          provide: IssueProviderService,
          useValue: {
            getCfgOnce$: jasmine.createSpy('getCfgOnce$').and.returnValue(of(cfg)),
          },
        },
      ],
    });

    service = TestBed.inject(BasecampCommonInterfacesService);
  });

  it('is enabled only when token, account, bucket, and todolist are configured', () => {
    expect(service.isEnabled(cfg)).toBeTrue();
    expect(service.isEnabled({ ...cfg, bucketId: null })).toBeFalse();
    expect(service.isEnabled({ ...cfg, accountId: null })).toBeFalse();
    expect(service.isEnabled({ ...cfg, accessToken: null })).toBeFalse();
    expect(service.isEnabled({ ...cfg, isEnabled: false })).toBeFalse();
    expect(service.isEnabled({ ...cfg, todolistId: null })).toBeFalse();
  });

  it('builds the Basecamp web URL for issueLink', async () => {
    const url = await service.issueLink('42', 'provider-1');
    expect(url).toBe('https://3.basecamp.com/123456/buckets/654321/todos/42');
  });

  it('returns an empty issueLink when account or bucket is missing', async () => {
    const issueProviderService = TestBed.inject(IssueProviderService);
    (issueProviderService.getCfgOnce$ as jasmine.Spy).and.returnValue(
      of({ ...cfg, accountId: null }),
    );

    const url = await service.issueLink('42', 'provider-1');

    expect(url).toBe('');
  });

  it('testConnection resolves true on successful todolist fetch', async () => {
    api.getTodolist$.and.returnValue(
      of({ id: 777, title: 'Sprint', completed: false } as any),
    );

    await expectAsync(service.testConnection(cfg)).toBeResolvedTo(true);
    expect(api.getTodolist$).toHaveBeenCalledWith('777', cfg);
  });

  it('testConnection resolves false on API errors or missing todolist id', async () => {
    api.getTodolist$.and.returnValue(throwError(() => new Error('404')));

    await expectAsync(service.testConnection(cfg)).toBeResolvedTo(false);
    await expectAsync(
      service.testConnection({ ...cfg, todolistId: null }),
    ).toBeResolvedTo(false);
  });

  it('maps a Basecamp todo into task data', () => {
    const result = service.getAddTaskData(
      createTodo({
        completed: true,
      }) as any,
    );

    expect(result.title).toBe('Follow up with client');
    expect(result.issueId).toBe('42');
    expect(result.issueType).toBe('BASECAMP');
    expect(result.isDone).toBeTrue();
    // notes are intentionally NOT mapped: Basecamp descriptions are HTML and
    // would clobber user-edited notes on every poll refresh
    expect(result.notes).toBeUndefined();
    expect(result.dueDay).toBe('2026-06-20');
    expect(result.issueLastUpdated).toBe(new Date('2026-06-17T10:15:00Z').getTime());
  });

  it('includes issueLastSyncedValues with completed field from sync adapter', () => {
    const result = service.getAddTaskData(createTodo({ completed: true }) as any);

    expect(result.issueLastSyncedValues).toEqual({ completed: true });
  });

  it('returns only todos not already imported when loading backlog items', async () => {
    api.listTodos$.and.returnValue(
      of({
        items: [
          { id: 1, content: 'Existing', completed: false },
          { id: 2, content: 'New', completed: false },
        ],
      } as any),
    );

    const result = await service.getNewIssuesToAddToBacklog('provider-1', ['1']);

    expect(api.listTodos$).toHaveBeenCalledWith('777', cfg);
    expect(result.map((todo: any) => todo.id)).toEqual([2]);
  });

  describe('getFreshDataForIssueTask', () => {
    // a remote update is detected via the todo's updated_at being newer than the
    // task's stored issueLastUpdated (createTask uses 2026-06-17T10:15:00Z)
    const NEWER = '2026-06-17T11:00:00Z';

    it('returns null when the todo has not been updated remotely', async () => {
      api.getTodo$.and.returnValue(of(createTodo()));

      await expectAsync(service.getFreshDataForIssueTask(createTask())).toBeResolvedTo(
        null,
      );
    });

    it('returns taskChanges when the todo title changes', async () => {
      api.getTodo$.and.returnValue(
        of(createTodo({ content: 'Updated title', updated_at: NEWER })),
      );

      const result = await service.getFreshDataForIssueTask(createTask());

      expect(result).not.toBeNull();
      expect(result!.taskChanges.title).toBe('Updated title');
      expect(result!.taskChanges.issueWasUpdated).toBeTrue();
    });

    it('returns taskChanges when the todo completion changes', async () => {
      api.getTodo$.and.returnValue(
        of(createTodo({ completed: true, updated_at: NEWER })),
      );

      const result = await service.getFreshDataForIssueTask(createTask());

      expect(result).not.toBeNull();
      expect(result!.taskChanges.isDone).toBeTrue();
      expect(result!.taskChanges.issueWasUpdated).toBeTrue();
    });

    it('does not overwrite the local schedule (dueDay) during polling', async () => {
      api.getTodo$.and.returnValue(
        of(createTodo({ due_on: '2026-06-25', updated_at: NEWER })),
      );

      const result = await service.getFreshDataForIssueTask(createTask());

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueDay).toBeUndefined();
    });

    it('does not overwrite local notes during polling', async () => {
      api.getTodo$.and.returnValue(
        of(createTodo({ content: 'Updated title', updated_at: NEWER })),
      );

      const result = await service.getFreshDataForIssueTask(createTask());

      expect(result!.taskChanges.notes).toBeUndefined();
    });
  });

  describe('getFreshDataForIssueTasks', () => {
    it('returns only tasks whose underlying todo was updated remotely', async () => {
      api.getTodo$
        .withArgs('42', cfg)
        .and.returnValue(
          of(
            createTodo({ content: 'Updated title', updated_at: '2026-06-17T11:00:00Z' }),
          ),
        );
      api.getTodo$
        .withArgs('43', cfg)
        .and.returnValue(of(createTodo({ id: 43, content: 'Unchanged task' })));

      const result = await service.getFreshDataForIssueTasks([
        createTask(),
        createTask({
          id: 'task-2',
          title: 'Unchanged task',
          issueId: '43',
          dueDay: undefined,
        }),
      ]);

      expect(result.length).toBe(1);
      expect(result[0].task.id).toBe('task-1');
      expect(result[0].taskChanges.title).toBe('Updated title');
    });
  });
});
