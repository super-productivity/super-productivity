import { TestBed } from '@angular/core/testing';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from './client-id.provider';
import { ClientIdService } from '../../core/util/client-id.service';

describe('CLIENT_ID_PROVIDER', () => {
  let provider: ClientIdProvider;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;

  beforeEach(() => {
    mockClientIdService = jasmine.createSpyObj('ClientIdService', ['loadClientId']);

    TestBed.configureTestingModule({
      providers: [{ provide: ClientIdService, useValue: mockClientIdService }],
    });

    provider = TestBed.inject(CLIENT_ID_PROVIDER);
  });

  it('should be provided in root', () => {
    expect(provider).toBeTruthy();
  });

  it('should delegate loadClientId to ClientIdService', async () => {
    const expectedClientId = 'test-client-id-123';
    mockClientIdService.loadClientId.and.resolveTo(expectedClientId);

    const result = await provider.loadClientId();

    expect(result).toBe(expectedClientId);
    expect(mockClientIdService.loadClientId).toHaveBeenCalledTimes(1);
  });

  it('should return null when ClientIdService returns null', async () => {
    mockClientIdService.loadClientId.and.resolveTo(null);

    const result = await provider.loadClientId();

    expect(result).toBeNull();
  });

  it('should propagate errors from ClientIdService', async () => {
    const error = new Error('Failed to load client ID');
    mockClientIdService.loadClientId.and.rejectWith(error);

    await expectAsync(provider.loadClientId()).toBeRejectedWith(error);
  });
});
