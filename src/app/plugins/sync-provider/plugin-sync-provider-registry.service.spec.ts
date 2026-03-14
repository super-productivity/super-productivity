import { TestBed } from '@angular/core/testing';
import { PluginSyncProviderRegistryService } from './plugin-sync-provider-registry.service';
import { SyncProviderPluginDefinition } from '@super-productivity/plugin-api';

const createMockDefinition = (
  overrides: Partial<SyncProviderPluginDefinition> = {},
): SyncProviderPluginDefinition => ({
  id: 'test',
  label: 'Test Provider',
  isReady: () => Promise.resolve(true),
  getFileRev: () => Promise.resolve({ rev: 'rev1' }),
  downloadFile: () => Promise.resolve({ rev: 'rev1', dataStr: '{}' }),
  uploadFile: () => Promise.resolve({ rev: 'rev2' }),
  removeFile: () => Promise.resolve(),
  ...overrides,
});

describe('PluginSyncProviderRegistryService', () => {
  let service: PluginSyncProviderRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginSyncProviderRegistryService],
    });
    service = TestBed.inject(PluginSyncProviderRegistryService);
  });

  describe('register', () => {
    it('should register a provider under plugin:<pluginId>', () => {
      service.register('my-webdav', createMockDefinition());

      expect(service.hasProvider('plugin:my-webdav')).toBeTrue();
    });

    it('should warn and reject duplicate registrations', () => {
      spyOn(console, 'warn');

      service.register('dup', createMockDefinition({ label: 'First' }));
      service.register('dup', createMockDefinition({ label: 'Second' }));

      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Duplicate registration'),
      );
      const provider = service.getProvider('plugin:dup');
      expect(provider!.label).toBe('First');
    });

    it('should emit on providerChanged$', () => {
      let emitted = false;
      service.providerChanged$.subscribe(() => (emitted = true));

      service.register('emitter', createMockDefinition());

      expect(emitted).toBeTrue();
    });
  });

  describe('unregister', () => {
    it('should remove a previously registered provider', () => {
      service.register('to-remove', createMockDefinition());
      expect(service.hasProvider('plugin:to-remove')).toBeTrue();

      service.unregister('to-remove');
      expect(service.hasProvider('plugin:to-remove')).toBeFalse();
    });

    it('should not throw when unregistering non-existent provider', () => {
      expect(() => service.unregister('does-not-exist')).not.toThrow();
    });

    it('should emit on providerChanged$', () => {
      service.register('will-unregister', createMockDefinition());
      let emitted = false;
      service.providerChanged$.subscribe(() => (emitted = true));

      service.unregister('will-unregister');

      expect(emitted).toBeTrue();
    });
  });

  describe('getProvider', () => {
    it('should return registered provider by key', () => {
      service.register(
        'provider-a',
        createMockDefinition({ label: 'Provider A', icon: 'cloud' }),
      );

      const provider = service.getProvider('plugin:provider-a');
      expect(provider).toBeDefined();
      expect(provider!.pluginId).toBe('provider-a');
      expect(provider!.label).toBe('Provider A');
      expect(provider!.icon).toBe('cloud');
    });

    it('should return undefined for unregistered key', () => {
      expect(service.getProvider('plugin:unknown')).toBeUndefined();
    });
  });

  describe('getAvailableProviders', () => {
    it('should return all registered providers', () => {
      service.register('p1', createMockDefinition({ label: 'P1' }));
      service.register('p2', createMockDefinition({ label: 'P2' }));

      const providers = service.getAvailableProviders();
      expect(providers.length).toBe(2);
      expect(providers.map((p) => p.pluginId)).toEqual(
        jasmine.arrayContaining(['p1', 'p2']),
      );
    });

    it('should return empty array when none registered', () => {
      expect(service.getAvailableProviders()).toEqual([]);
    });
  });

  describe('getRegisteredKey', () => {
    it('should return the key for a registered plugin', () => {
      service.register('my-plugin', createMockDefinition());
      expect(service.getRegisteredKey('my-plugin')).toBe('plugin:my-plugin');
    });

    it('should return undefined for unknown plugin', () => {
      expect(service.getRegisteredKey('unknown')).toBeUndefined();
    });
  });
});
