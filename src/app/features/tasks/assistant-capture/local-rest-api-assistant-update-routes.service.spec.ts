import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { LocalRestApiAssistantUpdateRoutesService } from './local-rest-api-assistant-update-routes.service';
import { TaskService } from '../task.service';
import { Task } from '../task.model';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { LocalRestApiRequestPayload } from '../../../../../electron/shared-with-frontend/local-rest-api.model';
import { selectTaskEntitiesInActiveProjects } from '../store/task.selectors';

describe('assistant task updates', () => {
  const initial = {
    id: 't1',
    isDone: false,
    title: 'original',
    priority: 'medium',
    notes: 'private',
  } as Task;
  const entities = signal<Record<string, Task>>({});
  const update = jasmine.createSpy('update');
  const flush = jasmine.createSpy('flushPendingWrites');
  const busy = jasmine.createSpy('isApplyingRemoteOps');
  const degraded = jasmine.createSpy('hasUnrecoveredPersistFailure');
  let service: LocalRestApiAssistantUpdateRoutesService;
  const call = (
    body: unknown,
    overrides: Partial<LocalRestApiRequestPayload> = {},
  ): ReturnType<LocalRestApiAssistantUpdateRoutesService['handle']> =>
    service.handle({
      requestId: 'r',
      source: 'mcp',
      method: 'POST',
      path: '/assistant/update',
      query: {},
      body,
      ...overrides,
    });
  beforeEach(() => {
    entities.set({ t1: { ...initial } });
    update.calls.reset();
    update.and.callFake((id: string, changes: Partial<Task>) =>
      entities.update((state) => ({
        ...state,
        [id]: { ...state[id], ...changes },
      })),
    );
    busy.and.returnValue(false);
    degraded.and.returnValue(false);
    flush.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Store,
          useValue: {
            selectSignal: (selector: unknown) => {
              expect(selector).toBe(selectTaskEntitiesInActiveProjects);
              return entities;
            },
          },
        },
        { provide: TaskService, useValue: { update } },
        { provide: HydrationStateService, useValue: { isApplyingRemoteOps: busy } },
        {
          provide: OperationCaptureService,
          useValue: { hasUnrecoveredPersistFailure: degraded },
        },
        { provide: OperationWriteFlushService, useValue: { flushPendingWrites: flush } },
      ],
    });
    service = TestBed.inject(LocalRestApiAssistantUpdateRoutesService);
  });

  it('sets both fields in one operation, treats retries as no-ops, and reopens', async () => {
    const set = { id: 't1', priority: 3, status: 'wont-do' };
    const response = await call(set);
    expect(response?.body).toEqual({ ok: true, data: { status: 'verified', task: set } });
    expect(entities()['t1'].doneOn).toEqual(entities()['t1'].wontDoOn);
    await call(set);
    expect(update).toHaveBeenCalledTimes(1);
    await call({ id: 't1', status: 'done' });
    expect(entities()['t1'].doneOn).not.toBe(entities()['t1'].wontDoOn);
    await call({ id: 't1', status: 'open', priority: null });
    expect(entities()['t1']).toEqual(
      jasmine.objectContaining({
        isDone: false,
        priority: null,
        title: 'original',
        notes: 'private',
      }),
    );
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('keeps the historical priority encoding on a semantic no-op', async () => {
    await call({ id: 't1', priority: 2 });
    expect(update).not.toHaveBeenCalled();
    expect(entities()['t1'].priority).toBe('medium');
  });

  it('rejects REST, unsupported input, inactive and inherited ids', async () => {
    const body = { id: 't1', status: 'done' };
    expect(await call(body, { source: undefined })).toBeUndefined();
    expect(await call(body, { method: 'GET' })).toBeUndefined();
    expect((await call({ ...body, title: 'other' }))?.status).toBe(400);
    for (const id of ['archived', 'constructor'])
      expect((await call({ ...body, id }))?.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('checks sync and persistence before dispatch and reports failed writes', async () => {
    const body = { id: 't1', status: 'done' };
    busy.and.returnValue(true);
    expect((await call(body))?.body).toEqual({ ok: true, data: { status: 'APP_BUSY' } });
    busy.and.returnValue(false);
    degraded.and.returnValue(true);
    expect((await call(body))?.body).toEqual({
      ok: true,
      data: { status: 'PERSIST_DEGRADED' },
    });
    expect(update).not.toHaveBeenCalled();
    degraded.and.returnValue(false);
    flush.and.rejectWith(new Error('disk'));
    expect((await call(body))?.body).toEqual({
      ok: true,
      data: { status: 'OUTCOME_UNKNOWN' },
    });
  });
});
