import { TestBed } from '@angular/core/testing';
import { LocalRestApiAssistantEditRoutesService } from './local-rest-api-assistant-edit-routes.service';
import { AssistantEditService } from './assistant-edit.service';
import { LocalRestApiRequestPayload } from '../../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiAssistantEditRoutesService', () => {
  let service: LocalRestApiAssistantEditRoutesService;
  let edit: jasmine.SpyObj<AssistantEditService>;

  const request = (
    path: string,
    body: unknown,
    source?: 'mcp',
    method: LocalRestApiRequestPayload['method'] = 'POST',
  ): LocalRestApiRequestPayload => ({
    requestId: 'r',
    method,
    path,
    query: {},
    body,
    source,
  });

  beforeEach(() => {
    edit = jasmine.createSpyObj<AssistantEditService>('AssistantEditService', [
      'updateTask',
      'startTracking',
      'stopTracking',
      'logTime',
    ]);
    edit.updateTask.and.resolveTo({ result: { status: 'applied', task: { id: 't1' } } });
    edit.stopTracking.and.resolveTo({
      result: { status: 'applied', currentTaskId: null },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: AssistantEditService, useValue: edit }],
    });
    service = TestBed.inject(LocalRestApiAssistantEditRoutesService);
  });

  it('does not exist for plain REST requests or other methods', async () => {
    const body = { id: 't1', isDone: true };
    expect(
      await service.handle(request('/assistant/tasks/update', body)),
    ).toBeUndefined();
    expect(
      await service.handle(request('/assistant/tasks/update', body, 'mcp', 'PATCH')),
    ).toBeUndefined();
    expect(await service.handle(request('/tasks/t1', body, 'mcp'))).toBeUndefined();
    expect(edit.updateTask).not.toHaveBeenCalled();
  });

  it('runs a parsed edit and answers its result', async () => {
    const res = await service.handle(
      request('/assistant/tasks/update', { id: 't1', isDone: true }, 'mcp'),
    );
    expect(edit.updateTask).toHaveBeenCalledOnceWith({ id: 't1', isDone: true });
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({
      ok: true,
      data: { status: 'applied', task: { id: 't1' } },
    });
    const stop = await service.handle(request('/assistant/tasks/stop', {}, 'mcp'));
    expect(stop?.status).toBe(200);
  });

  it('answers a refusal with its code only', async () => {
    edit.updateTask.and.resolveTo({ rejection: 'ISSUE_LINKED_TASK' });
    const res = await service.handle(
      request('/assistant/tasks/update', { id: 't1', title: 'x' }, 'mcp'),
    );
    expect(res?.status).toBe(409);
    expect(res?.body).toEqual(
      jasmine.objectContaining({
        ok: false,
        error: jasmine.objectContaining({ code: 'ISSUE_LINKED_TASK' }),
      }),
    );
  });

  it('rejects an invalid body without running anything', async () => {
    const res = await service.handle(
      request('/assistant/tasks/update', { id: 't1', notes: 'x' }, 'mcp'),
    );
    expect(res?.status).toBe(400);
    const stop = await service.handle(
      request('/assistant/tasks/stop', { id: 't1' }, 'mcp'),
    );
    expect(stop?.status).toBe(400);
    expect(edit.updateTask).not.toHaveBeenCalled();
    expect(edit.stopTracking).not.toHaveBeenCalled();
  });
});
