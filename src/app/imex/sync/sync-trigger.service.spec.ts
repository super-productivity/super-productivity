import { TestBed } from '@angular/core/testing';
import { SyncTriggerService } from './sync-trigger.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IdleService } from '../../features/idle/idle.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { Store } from '@ngrx/store';
import { of, ReplaySubject } from 'rxjs';

describe('SyncTriggerService', () => {
  let service: SyncTriggerService;
  let globalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let dataInitStateService: jasmine.SpyObj<DataInitStateService>;
  let idleService: jasmine.SpyObj<IdleService>;
  let syncWrapperService: jasmine.SpyObj<SyncWrapperService>;
  let store: jasmine.SpyObj<Store>;

  beforeEach(() => {
    const isAllDataLoadedSubject = new ReplaySubject<boolean>(1);
    isAllDataLoadedSubject.next(true);

    globalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: of({ sync: { isEnabled: false } }),
      idle$: of({ isEnableIdleTimeTracking: false }),
    });

    dataInitStateService = jasmine.createSpyObj('DataInitStateService', [], {
      isAllDataLoadedInitially$: isAllDataLoadedSubject.asObservable(),
    });

    idleService = jasmine.createSpyObj('IdleService', [], {
      isIdle$: of(false),
    });

    syncWrapperService = jasmine.createSpyObj('SyncWrapperService', [], {
      syncProviderId$: of(null),
      isWaitingForUserInput$: of(false),
    });

    store = jasmine.createSpyObj('Store', ['select']);
    store.select.and.returnValue(of(null));

    TestBed.configureTestingModule({
      providers: [
        SyncTriggerService,
        { provide: GlobalConfigService, useValue: globalConfigService },
        { provide: DataInitStateService, useValue: dataInitStateService },
        { provide: IdleService, useValue: idleService },
        { provide: SyncWrapperService, useValue: syncWrapperService },
        { provide: Store, useValue: store },
      ],
    });

    service = TestBed.inject(SyncTriggerService);
  });

  describe('isInitialSyncDoneSync', () => {
    it('should return false initially', () => {
      expect(service.isInitialSyncDoneSync()).toBe(false);
    });

    it('should return true after setInitialSyncDone(true)', () => {
      service.setInitialSyncDone(true);
      expect(service.isInitialSyncDoneSync()).toBe(true);
    });

    it('should return false after setInitialSyncDone(false)', () => {
      service.setInitialSyncDone(true);
      expect(service.isInitialSyncDoneSync()).toBe(true);

      service.setInitialSyncDone(false);
      expect(service.isInitialSyncDoneSync()).toBe(false);
    });

    it('should track multiple state changes', () => {
      expect(service.isInitialSyncDoneSync()).toBe(false);

      service.setInitialSyncDone(true);
      expect(service.isInitialSyncDoneSync()).toBe(true);

      service.setInitialSyncDone(false);
      expect(service.isInitialSyncDoneSync()).toBe(false);

      service.setInitialSyncDone(true);
      expect(service.isInitialSyncDoneSync()).toBe(true);
    });
  });

  describe('setInitialSyncDone', () => {
    it('should update both sync flag and observable', (done) => {
      let observedValue: boolean | undefined;

      // Subscribe to the observable (it's a ReplaySubject internally)
      service['_isInitialSyncDoneManual$'].subscribe((val) => {
        observedValue = val;
      });

      service.setInitialSyncDone(true);

      // Check sync getter
      expect(service.isInitialSyncDoneSync()).toBe(true);

      // Check observable received the value
      expect(observedValue).toBe(true);
      done();
    });
  });
});
