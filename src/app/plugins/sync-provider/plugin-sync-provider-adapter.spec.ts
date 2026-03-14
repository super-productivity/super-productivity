import { PluginSyncProviderAdapter } from './plugin-sync-provider-adapter';
import { SyncProviderPluginDefinition } from '@super-productivity/plugin-api';

const createMockDefinition = (
  overrides: Partial<SyncProviderPluginDefinition> = {},
): SyncProviderPluginDefinition => ({
  id: 'test',
  label: 'Test Provider',
  maxConcurrentRequests: 8,
  isUploadForcePossible: true,
  isReady: jasmine.createSpy('isReady').and.returnValue(Promise.resolve(true)),
  getFileRev: jasmine
    .createSpy('getFileRev')
    .and.returnValue(Promise.resolve({ rev: 'rev1' })),
  downloadFile: jasmine
    .createSpy('downloadFile')
    .and.returnValue(Promise.resolve({ rev: 'rev1', dataStr: '{"data":true}' })),
  uploadFile: jasmine
    .createSpy('uploadFile')
    .and.returnValue(Promise.resolve({ rev: 'rev2' })),
  removeFile: jasmine.createSpy('removeFile').and.returnValue(Promise.resolve()),
  ...overrides,
});

describe('PluginSyncProviderAdapter', () => {
  it('should set id to plugin:<pluginId>', () => {
    const adapter = new PluginSyncProviderAdapter('my-webdav', createMockDefinition());
    expect(adapter.id as unknown as string).toBe('plugin:my-webdav');
  });

  it('should use maxConcurrentRequests from definition', () => {
    const adapter = new PluginSyncProviderAdapter(
      'test',
      createMockDefinition({ maxConcurrentRequests: 12 }),
    );
    expect(adapter.maxConcurrentRequests).toBe(12);
  });

  it('should default maxConcurrentRequests to 5', () => {
    const def = createMockDefinition();
    delete (def as any).maxConcurrentRequests;
    const adapter = new PluginSyncProviderAdapter('test', def);
    expect(adapter.maxConcurrentRequests).toBe(5);
  });

  it('should delegate isReady to definition', async () => {
    const def = createMockDefinition();
    const adapter = new PluginSyncProviderAdapter('test', def);

    const result = await adapter.isReady();

    expect(result).toBeTrue();
    expect(def.isReady).toHaveBeenCalled();
  });

  it('should delegate getFileRev to definition', async () => {
    const def = createMockDefinition();
    const adapter = new PluginSyncProviderAdapter('test', def);

    const result = await adapter.getFileRev('/path/file.json', 'oldrev');

    expect(result).toEqual({ rev: 'rev1' });
    expect(def.getFileRev).toHaveBeenCalledWith('/path/file.json', 'oldrev');
  });

  it('should delegate downloadFile to definition', async () => {
    const def = createMockDefinition();
    const adapter = new PluginSyncProviderAdapter('test', def);

    const result = await adapter.downloadFile('/path/file.json');

    expect(result.rev).toBe('rev1');
    expect(result.dataStr).toBe('{"data":true}');
    expect(def.downloadFile).toHaveBeenCalledWith('/path/file.json');
  });

  it('should delegate uploadFile to definition', async () => {
    const def = createMockDefinition();
    const adapter = new PluginSyncProviderAdapter('test', def);

    const result = await adapter.uploadFile('/path/file.json', '{}', 'rev1', false);

    expect(result).toEqual({ rev: 'rev2' });
    expect(def.uploadFile).toHaveBeenCalledWith('/path/file.json', '{}', 'rev1', false);
  });

  it('should delegate removeFile to definition', async () => {
    const def = createMockDefinition();
    const adapter = new PluginSyncProviderAdapter('test', def);

    await adapter.removeFile('/path/file.json');

    expect(def.removeFile).toHaveBeenCalledWith('/path/file.json');
  });

  it('should have a no-op setPrivateCfg', async () => {
    const adapter = new PluginSyncProviderAdapter('test', createMockDefinition());
    await expectAsync(adapter.setPrivateCfg()).toBeResolved();
  });

  it('should have a no-op privateCfg.load that returns empty object', async () => {
    const adapter = new PluginSyncProviderAdapter('test', createMockDefinition());
    const result = await adapter.privateCfg.load();
    expect(result).toBeDefined();
  });
});
