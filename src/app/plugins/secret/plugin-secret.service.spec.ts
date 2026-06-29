import { TestBed } from '@angular/core/testing';
import { MAX_PLUGIN_SECRET_LENGTH, PluginSecretService } from './plugin-secret.service';
import { deleteSecret, getAllSecretKeys } from './plugin-secret-store';

/**
 * Runs against the real `sup-plugin-secrets` IndexedDB (Karma uses real
 * Chrome). afterEach wipes the store so specs don't leak into each other.
 */
describe('PluginSecretService', () => {
  let service: PluginSecretService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PluginSecretService);
  });

  afterEach(async () => {
    const keys = await getAllSecretKeys();
    for (const key of keys) {
      await deleteSecret(key);
    }
  });

  it('round-trips a secret', async () => {
    await service.setSecret('plugin-a', 'password', 's3cret');
    expect(await service.getSecret('plugin-a', 'password')).toBe('s3cret');
  });

  it('returns null for a missing secret', async () => {
    expect(await service.getSecret('plugin-a', 'nope')).toBeNull();
  });

  it('namespaces secrets per plugin', async () => {
    await service.setSecret('plugin-a', 'password', 'a-secret');
    await service.setSecret('plugin-b', 'password', 'b-secret');
    expect(await service.getSecret('plugin-a', 'password')).toBe('a-secret');
    expect(await service.getSecret('plugin-b', 'password')).toBe('b-secret');
  });

  it('deletes a single secret without touching others', async () => {
    await service.setSecret('plugin-a', 'password', 'pw');
    await service.setSecret('plugin-a', 'token', 'tk');
    await service.deleteSecret('plugin-a', 'password');
    expect(await service.getSecret('plugin-a', 'password')).toBeNull();
    expect(await service.getSecret('plugin-a', 'token')).toBe('tk');
  });

  it('removeSecretsForPlugin purges only the owner plugin', async () => {
    await service.setSecret('plugin-a', 'password', 'pw');
    await service.setSecret('plugin-a', 'token', 'tk');
    await service.setSecret('plugin-b', 'password', 'keep');
    await service.removeSecretsForPlugin('plugin-a');
    expect(await service.getSecret('plugin-a', 'password')).toBeNull();
    expect(await service.getSecret('plugin-a', 'token')).toBeNull();
    expect(await service.getSecret('plugin-b', 'password')).toBe('keep');
  });

  it('removeSecretsForPlugin does not purge a prefix-colliding plugin', async () => {
    // 'plugin-a' must not match 'plugin-ab' during cleanup.
    await service.setSecret('plugin-a', 'k', 'a');
    await service.setSecret('plugin-ab', 'k', 'ab');
    await service.removeSecretsForPlugin('plugin-a');
    expect(await service.getSecret('plugin-a', 'k')).toBeNull();
    expect(await service.getSecret('plugin-ab', 'k')).toBe('ab');
  });

  it('rejects an empty key', async () => {
    await expectAsync(service.setSecret('plugin-a', '', 'x')).toBeRejectedWithError(
      /non-empty string/,
    );
  });

  it('rejects a non-string value', async () => {
    await expectAsync(
      service.setSecret('plugin-a', 'k', 123 as unknown as string),
    ).toBeRejectedWithError(/must be a string/);
  });

  it('rejects an oversized value', async () => {
    const huge = 'x'.repeat(MAX_PLUGIN_SECRET_LENGTH + 1);
    await expectAsync(service.setSecret('plugin-a', 'k', huge)).toBeRejectedWithError(
      /maximum length/,
    );
  });

  it('rejects a pluginId containing the reserved delimiter', async () => {
    await expectAsync(service.setSecret('plugin:evil', 'k', 'x')).toBeRejectedWithError(
      /must not contain/,
    );
  });
});
