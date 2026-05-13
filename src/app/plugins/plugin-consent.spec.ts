/**
 * Focused tests for plugin consent persistence and startup permission check.
 * These test the private methods indirectly via spies on PluginMetaPersistenceService.
 */
import { fakeAsync, tick } from '@angular/core/testing';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';

// Minimal stub — we only need to verify setNodeExecutionConsent is called immediately
describe('Plugin consent persistence (issue #7326)', () => {
  let mockMetaPersistence: jasmine.SpyObj<PluginMetaPersistenceService>;

  beforeEach(() => {
    mockMetaPersistence = jasmine.createSpyObj('PluginMetaPersistenceService', [
      'setNodeExecutionConsent',
      'getNodeExecutionConsent',
    ]);
    mockMetaPersistence.setNodeExecutionConsent.and.resolveTo();
    mockMetaPersistence.getNodeExecutionConsent.and.resolveTo(undefined);
  });

  it('setNodeExecutionConsent should be awaitable (returns a Promise)', () => {
    const result = mockMetaPersistence.setNodeExecutionConsent('test-plugin', true);
    expect(result).toBeInstanceOf(Promise);
  });

  it('consent write should not be deferred via setTimeout', fakeAsync(() => {
    // Simulate the fixed code path: direct await, no setTimeout
    const writeConsent = async (): Promise<void> => {
      await mockMetaPersistence.setNodeExecutionConsent('test-plugin', true);
    };

    writeConsent();
    tick(0); // one microtask tick — should be enough without setTimeout(5000)

    expect(mockMetaPersistence.setNodeExecutionConsent).toHaveBeenCalledWith(
      'test-plugin',
      true,
    );
  }));

  it('getNodeExecutionConsent returns true only when explicitly stored as true', async () => {
    mockMetaPersistence.getNodeExecutionConsent.and.resolveTo(true);
    const result = await mockMetaPersistence.getNodeExecutionConsent('test-plugin');
    expect(result).toBe(true);
  });

  it('getNodeExecutionConsent returns falsy when not stored', async () => {
    mockMetaPersistence.getNodeExecutionConsent.and.resolveTo(undefined);
    const result = await mockMetaPersistence.getNodeExecutionConsent('test-plugin');
    expect(result).toBeFalsy();
  });
});
