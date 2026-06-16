import { TestBed } from '@angular/core/testing';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { TagService } from '../../tag/tag.service';

describe('IssueSyncAdapterResolverService', () => {
  let service: IssueSyncAdapterResolverService;
  let adapterRegistry: IssueSyncAdapterRegistryService;
  let pluginRegistry: jasmine.SpyObj<PluginIssueProviderRegistryService>;

  const existingAdapter = {} as IssueSyncAdapter<unknown>;

  beforeEach(() => {
    pluginRegistry = jasmine.createSpyObj<PluginIssueProviderRegistryService>(
      'PluginIssueProviderRegistryService',
      ['getProvider'],
    );

    TestBed.configureTestingModule({
      providers: [
        IssueSyncAdapterResolverService,
        IssueSyncAdapterRegistryService,
        { provide: PluginIssueProviderRegistryService, useValue: pluginRegistry },
        {
          provide: PluginHttpService,
          useValue: jasmine.createSpyObj<PluginHttpService>('PluginHttpService', [
            'createHttpHelper',
          ]),
        },
        { provide: TagService, useValue: { tags: () => [] } },
      ],
    });

    service = TestBed.inject(IssueSyncAdapterResolverService);
    adapterRegistry = TestBed.inject(IssueSyncAdapterRegistryService);
  });

  it('returns an existing registered adapter without consulting plugin providers', () => {
    adapterRegistry.register('plugin:test', existingAdapter);

    expect(service.getAdapter('plugin:test')).toBe(existingAdapter);
    expect(pluginRegistry.getProvider).not.toHaveBeenCalled();
  });

  it('lazily creates and registers plugin adapters for writable providers', () => {
    pluginRegistry.getProvider.and.returnValue({
      allowPrivateNetwork: true,
      definition: {
        getHeaders: () => ({}),
        updateIssue: jasmine.createSpy('updateIssue'),
      },
    } as any);

    const adapter = service.getAdapter('plugin:test');

    expect(adapter).toBeTruthy();
    expect(adapterRegistry.get('plugin:test')).toBe(adapter);
    expect(adapter?.pushChanges).toEqual(jasmine.any(Function));
  });

  it('does not create adapters for plugins without issue side effects', () => {
    pluginRegistry.getProvider.and.returnValue({
      definition: { getHeaders: () => ({}) },
    } as any);

    expect(service.getAdapter('plugin:test')).toBeUndefined();
    expect(adapterRegistry.get('plugin:test')).toBeUndefined();
  });
});
