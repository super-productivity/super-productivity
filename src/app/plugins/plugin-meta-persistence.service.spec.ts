import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PluginMetadata } from './plugin-persistence.model';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { upsertPluginMetadata } from './store/plugin.actions';
import { selectPluginMetadataFeatureState } from './store/plugin-metadata.reducer';

describe('PluginMetaPersistenceService', () => {
  let service: PluginMetaPersistenceService;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginMetaPersistenceService,
        provideMockStore({
          selectors: [
            {
              selector: selectPluginMetadataFeatureState,
              value: [
                {
                  id: 'plugin-a',
                  isEnabled: false,
                  nodeExecutionConsent: { isGranted: true },
                } as unknown as PluginMetadata,
              ],
            },
          ],
        }),
      ],
    });

    service = TestBed.inject(PluginMetaPersistenceService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  // SYNC-EXCLUSION GUARD (issue #8512 Phase 2). nodeExecution consent is persisted in a
  // main-owned, local-only store (electron/plugin-node-consent-store.ts) and must NEVER
  // leak into the pfapi-synced `pluginMetadata` — otherwise a grant on one device would
  // auto-grant on another. The strict `toHaveBeenCalledOnceWith({id,isEnabled})` below
  // deep-matches the dispatched payload, so any consent field reappearing here fails.
  it('does not re-persist stale nodeExecution consent metadata', async () => {
    await service.setPluginEnabled('plugin-a', true);

    expect(store.dispatch).toHaveBeenCalledOnceWith(
      upsertPluginMetadata({
        pluginMetadata: {
          id: 'plugin-a',
          isEnabled: true,
        },
      }),
    );
  });
});
