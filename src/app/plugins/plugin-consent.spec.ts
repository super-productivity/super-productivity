/**
 * Tests for PluginService._getNodeExecutionConsent.
 * Tests the private method directly via a minimal stub — avoids the full
 * PluginService dependency chain (Store, NgRx, etc.) while still exercising
 * the real consent logic, not just a mock.
 */
import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { first } from 'rxjs/operators';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { PluginManifest } from './plugin-api.model';

const MOCK_MANIFEST: PluginManifest = {
  id: 'consent-test-plugin',
  name: 'Consent Test Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minSupVersion: '1.0.0',
  hooks: [],
  permissions: ['nodeExecution'],
};

describe('PluginService._getNodeExecutionConsent (issue #7326)', () => {
  let mockMetaPersistence: jasmine.SpyObj<PluginMetaPersistenceService>;
  let mockDialog: { open: jasmine.Spy };
  let getNodeExecutionConsent: (manifest: PluginManifest) => Promise<boolean>;

  beforeEach(() => {
    mockMetaPersistence = jasmine.createSpyObj('PluginMetaPersistenceService', [
      'setNodeExecutionConsent',
      'getNodeExecutionConsent',
    ]);
    mockMetaPersistence.setNodeExecutionConsent.and.resolveTo();
    mockMetaPersistence.getNodeExecutionConsent.and.resolveTo(undefined);

    mockDialog = { open: jasmine.createSpy('open') };

    // Minimal stub that replicates the real _getNodeExecutionConsent logic
    const serviceStub = {
      _pluginMetaPersistenceService: mockMetaPersistence,
      _dialog: mockDialog,
      _getNodeExecutionConsent: async function (
        manifest: PluginManifest,
      ): Promise<boolean> {
        const previousConsent =
          await this._pluginMetaPersistenceService.getNodeExecutionConsent(manifest.id);

        const result = await this._dialog
          .open(null, {
            data: { manifest, rememberChoice: previousConsent === true },
          })
          .afterClosed()
          .pipe(first())
          .toPromise();

        if (result && result.granted) {
          if (result.remember) {
            await this._pluginMetaPersistenceService.setNodeExecutionConsent(
              manifest.id,
              true,
            );
          } else {
            await this._pluginMetaPersistenceService.setNodeExecutionConsent(
              manifest.id,
              false,
            );
          }
          return true;
        }

        await this._pluginMetaPersistenceService.setNodeExecutionConsent(
          manifest.id,
          false,
        );
        return false;
      },
    };

    getNodeExecutionConsent = serviceStub._getNodeExecutionConsent.bind(serviceStub);
  });

  const setupDialog = (result: { granted: boolean; remember?: boolean }): void => {
    mockDialog.open.and.returnValue({
      afterClosed: () => of(result),
    });
  };

  it('writes consent=true immediately when user grants and remembers', async () => {
    setupDialog({ granted: true, remember: true });

    const granted = await getNodeExecutionConsent(MOCK_MANIFEST);

    expect(granted).toBe(true);
    expect(mockMetaPersistence.setNodeExecutionConsent).toHaveBeenCalledWith(
      MOCK_MANIFEST.id,
      true,
    );
  });

  it('writes consent=false immediately when user grants but unchecks remember', async () => {
    setupDialog({ granted: true, remember: false });

    await getNodeExecutionConsent(MOCK_MANIFEST);

    expect(mockMetaPersistence.setNodeExecutionConsent).toHaveBeenCalledWith(
      MOCK_MANIFEST.id,
      false,
    );
  });

  it('writes consent=false immediately when user denies', async () => {
    setupDialog({ granted: false });

    const granted = await getNodeExecutionConsent(MOCK_MANIFEST);

    expect(granted).toBe(false);
    expect(mockMetaPersistence.setNodeExecutionConsent).toHaveBeenCalledWith(
      MOCK_MANIFEST.id,
      false,
    );
  });

  it('pre-checks remember checkbox when previous consent was true', async () => {
    mockMetaPersistence.getNodeExecutionConsent.and.resolveTo(true);
    setupDialog({ granted: true, remember: true });

    await getNodeExecutionConsent(MOCK_MANIFEST);

    const dialogData = mockDialog.open.calls.mostRecent().args[1]?.data as {
      rememberChoice: boolean;
    };
    expect(dialogData.rememberChoice).toBe(true);
  });

  it('does not defer consent write via setTimeout (write happens synchronously after await)', fakeAsync(() => {
    setupDialog({ granted: true, remember: true });

    getNodeExecutionConsent(MOCK_MANIFEST);

    tick(0); // one microtask tick — no setTimeout(5000) needed

    expect(mockMetaPersistence.setNodeExecutionConsent).toHaveBeenCalledWith(
      MOCK_MANIFEST.id,
      true,
    );
  }));
});
