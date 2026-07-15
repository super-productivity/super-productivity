import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import {
  SyncProviderManager,
  notifyFileProviderTargetChanged,
} from './provider-manager.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SnackService } from '../../core/snack/snack.service';

/**
 * Task 2 (sync-simplification plan): the LocalFile folder picker and Android
 * setupSaf mutate the sync target without going through setProviderConfig(), so
 * they must still trigger the providerConfigChanged$ invalidation that
 * WrappedProviderService uses to reset file-adapter target state.
 */
describe('SyncProviderManager target-change notification', () => {
  let service: SyncProviderManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SyncProviderManager,
        provideMockStore({}),
        {
          provide: DataInitStateService,
          // Never emits, so the constructor's sync-config subscription stays
          // inert and we don't need to mock provider loading.
          useValue: { isAllDataLoadedInitially$: new Subject<boolean>() },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    service = TestBed.inject(SyncProviderManager);
  });

  it('emits providerConfigChanged$ when notifyProviderConfigChanged() is called', () => {
    const spy = jasmine.createSpy('providerConfigChanged');
    const sub = service.providerConfigChanged$.subscribe(spy);

    service.notifyProviderConfigChanged();

    expect(spy).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('routes the module-level notifyFileProviderTargetChanged() to the registered instance', () => {
    // Injecting the service self-registered it as the module singleton.
    const spy = jasmine.createSpy('providerConfigChanged');
    const sub = service.providerConfigChanged$.subscribe(spy);

    notifyFileProviderTargetChanged();

    expect(spy).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });
});
