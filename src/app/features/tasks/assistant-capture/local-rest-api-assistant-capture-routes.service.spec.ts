import { TestBed } from '@angular/core/testing';
import { LocalRestApiAssistantCaptureRoutesService } from './local-rest-api-assistant-capture-routes.service';
import { AssistantCaptureService } from './assistant-capture.service';
import { LocalRestApiRequestPayload } from '../../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiAssistantCaptureRoutesService', () => {
  let service: LocalRestApiAssistantCaptureRoutesService;
  let assistantCaptureMock: jasmine.SpyObj<AssistantCaptureService>;

  const createRequest = (body: unknown, source?: 'mcp'): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method: 'POST',
    path: '/assistant/capture',
    query: {},
    body,
    source,
  });

  beforeEach(() => {
    assistantCaptureMock = jasmine.createSpyObj<AssistantCaptureService>(
      'AssistantCaptureService',
      ['capture'],
    );
    assistantCaptureMock.capture.and.resolveTo({ status: 'created', id: 'captured' });

    TestBed.configureTestingModule({
      providers: [{ provide: AssistantCaptureService, useValue: assistantCaptureMock }],
    });
    service = TestBed.inject(LocalRestApiAssistantCaptureRoutesService);
  });

  it('does not exist for plain REST requests', async () => {
    const res = await service.handle(createRequest({ title: 'x' }));
    expect(res).toBeUndefined();
    expect(assistantCaptureMock.capture).not.toHaveBeenCalled();
  });

  it('captures for requests the main process marked as assistant calls', async () => {
    const res = await service.handle(createRequest({ title: ' x ' }, 'mcp'));
    expect(res?.status).toBe(200);
    expect(res?.body).toEqual({ ok: true, data: { status: 'created', id: 'captured' } });
    expect(assistantCaptureMock.capture).toHaveBeenCalledOnceWith({ title: 'x' });
  });

  it('rejects an invalid capture', async () => {
    const res = await service.handle(createRequest({ title: 'x', tagIds: [] }, 'mcp'));
    expect(res?.status).toBe(400);
    expect(assistantCaptureMock.capture).not.toHaveBeenCalled();
  });
});
