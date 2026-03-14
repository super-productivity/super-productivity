import {
  SyncProviderId,
  toSyncProviderId,
  isPluginSyncProviderId,
} from './provider.const';

describe('provider.const', () => {
  describe('toSyncProviderId', () => {
    it('should return SyncProviderId for valid built-in values', () => {
      expect(toSyncProviderId('Dropbox')).toBe(SyncProviderId.Dropbox);
      expect(toSyncProviderId('WebDAV')).toBe(SyncProviderId.WebDAV);
      expect(toSyncProviderId('LocalFile')).toBe(SyncProviderId.LocalFile);
      expect(toSyncProviderId('SuperSync')).toBe(SyncProviderId.SuperSync);
    });

    it('should return null for null/undefined', () => {
      expect(toSyncProviderId(null)).toBeNull();
      expect(toSyncProviderId(undefined)).toBeNull();
    });

    it('should return null for unknown values', () => {
      expect(toSyncProviderId('Unknown')).toBeNull();
      expect(toSyncProviderId('')).toBeNull();
    });

    it('should accept plugin:* strings', () => {
      const result = toSyncProviderId('plugin:my-webdav');
      expect(result).toBe('plugin:my-webdav' as unknown as SyncProviderId);
    });

    it('should accept plugin: with various IDs', () => {
      expect(toSyncProviderId('plugin:webdav-sync')).toBeTruthy();
      expect(toSyncProviderId('plugin:custom-provider')).toBeTruthy();
    });
  });

  describe('isPluginSyncProviderId', () => {
    it('should return true for plugin:* strings', () => {
      expect(isPluginSyncProviderId('plugin:my-webdav')).toBeTrue();
      expect(isPluginSyncProviderId('plugin:test')).toBeTrue();
    });

    it('should return false for non-plugin strings', () => {
      expect(isPluginSyncProviderId('Dropbox')).toBeFalse();
      expect(isPluginSyncProviderId('WebDAV')).toBeFalse();
      expect(isPluginSyncProviderId('')).toBeFalse();
      expect(isPluginSyncProviderId('plugintest')).toBeFalse();
    });
  });
});
