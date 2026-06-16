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
