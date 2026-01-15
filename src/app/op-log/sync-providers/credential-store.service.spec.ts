import { SyncCredentialStore } from './credential-store.service';
import { SyncProviderId } from './provider.const';
import { DropboxPrivateCfg } from './file-based/dropbox/dropbox';

/**
 * Tests for SyncCredentialStore
 *
 * This service handles OAuth tokens and provider credentials.
 * Tests focus on:
 * - Basic CRUD operations
 * - Memory caching behavior
 * - Error handling and security
 *
 * NOTE: Tests use unique tokens per test to avoid interference.
 * IndexedDB cleanup between tests is unreliable in browser test environments.
 */
describe('SyncCredentialStore', () => {
  let store: SyncCredentialStore<SyncProviderId.Dropbox>;
  let testRunId: string;

  // Helper to create typed test credentials with unique IDs
  const createTestCredentials = (suffix = ''): DropboxPrivateCfg => ({
    accessToken: `test-token-${testRunId}-${suffix}`,
    refreshToken: `test-refresh-${testRunId}-${suffix}`,
  });

  beforeEach(() => {
    // Use unique ID per test to avoid test pollution without database cleanup
    testRunId = Math.random().toString(36).substring(7);
    store = new SyncCredentialStore(SyncProviderId.Dropbox);
  });

  describe('load', () => {
    it('should return null when no credentials exist for fresh store', async () => {
      // Use a unique provider ID to ensure no pre-existing data
      const freshStore = new SyncCredentialStore(SyncProviderId.LocalFile);
      // Clear any existing data first
      await freshStore.clear();
      const result = await freshStore.load();
      expect(result).toBeNull();
    });

    it('should return saved credentials', async () => {
      const testCredentials = createTestCredentials('save-return');
      await store.setComplete(testCredentials);

      const result = await store.load();
      expect(result).toEqual(testCredentials);
    });

    it('should cache credentials in memory after first load', async () => {
      const testCredentials = createTestCredentials('cache');
      await store.setComplete(testCredentials);

      // First load - from IndexedDB
      const result1 = await store.load();
      expect(result1).toEqual(testCredentials);

      // Second load - should use memory cache
      const result2 = await store.load();
      expect(result2).toEqual(testCredentials);
    });
  });

  describe('setComplete', () => {
    it('should save credentials and persist them', async () => {
      const testCredentials = createTestCredentials('persist');
      await store.setComplete(testCredentials);

      // Create a new store instance to verify persistence
      const newStore = new SyncCredentialStore(SyncProviderId.Dropbox);
      const result = await newStore.load();
      expect(result).toEqual(testCredentials);
    });

    it('should overwrite existing credentials', async () => {
      const credentials1 = createTestCredentials('v1');
      const credentials2 = createTestCredentials('v2');

      await store.setComplete(credentials1);
      await store.setComplete(credentials2);

      const result = await store.load();
      expect(result).toEqual(credentials2);
    });

    it('should notify change callback when set', async () => {
      const callback = jasmine.createSpy('callback');
      store.onConfigChange(callback);

      const testCredentials = createTestCredentials('callback');
      await store.setComplete(testCredentials);

      expect(callback).toHaveBeenCalledWith({
        providerId: SyncProviderId.Dropbox,
        privateCfg: testCredentials,
      });
    });
  });

  describe('updatePartial', () => {
    it('should merge updates with existing credentials', async () => {
      const initialCredentials = createTestCredentials('initial');
      await store.setComplete(initialCredentials);

      const updatedToken = `updated-token-${testRunId}`;
      await store.updatePartial({ accessToken: updatedToken });

      const result = await store.load();
      expect(result?.accessToken).toBe(updatedToken);
      expect(result?.refreshToken).toBe(initialCredentials.refreshToken);
    });
  });

  describe('clear', () => {
    it('should remove credentials from store', async () => {
      await store.setComplete(createTestCredentials('to-clear'));

      // Verify credentials exist
      expect(await store.load()).not.toBeNull();

      await store.clear();

      // After clear, should return null
      expect(await store.load()).toBeNull();
    });
  });

  describe('security considerations', () => {
    it('should not include credentials in string representation', async () => {
      const sensitiveCredentials: DropboxPrivateCfg = {
        accessToken: 'SECRET_TOKEN_12345',
        refreshToken: 'SECRET_REFRESH_67890',
      };

      await store.setComplete(sensitiveCredentials);

      // The store object itself should not leak credentials in toString
      const storeString = String(store);
      expect(storeString).not.toContain('SECRET_TOKEN');
      expect(storeString).not.toContain('SECRET_REFRESH');
    });
  });
});
