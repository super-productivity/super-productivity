import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SyncTriggerService } from './sync-trigger.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IdleService } from '../../features/idle/idle.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Observable, of, ReplaySubject } from 'rxjs';

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
      cfg$: of({ sync: { isEnabled: true } }),
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

  describe('constructor initial sync subscription', () => {
    it('should call setInitialSyncDone(true) when sync is disabled', () => {
      // Default setup has sync enabled, so create a new service with sync disabled
      TestBed.resetTestingModule();
      const isAllDataLoaded$ = new ReplaySubject<boolean>(1);
      isAllDataLoaded$.next(true);

      TestBed.configureTestingModule({
        providers: [
          SyncTriggerService,
          {
            provide: GlobalConfigService,
            useValue: jasmine.createSpyObj('GlobalConfigService', [], {
              cfg$: of({ sync: { isEnabled: false } }),
              idle$: of({ isEnableIdleTimeTracking: false }),
            }),
          },
          {
            provide: DataInitStateService,
            useValue: jasmine.createSpyObj('DataInitStateService', [], {
              isAllDataLoadedInitially$: isAllDataLoaded$.asObservable(),
            }),
          },
          {
            provide: IdleService,
            useValue: jasmine.createSpyObj('IdleService', [], {
              isIdle$: of(false),
            }),
          },
          {
            provide: SyncWrapperService,
            useValue: jasmine.createSpyObj('SyncWrapperService', [], {
              syncProviderId$: of(null),
              isWaitingForUserInput$: of(false),
            }),
          },
          {
            provide: Store,
            useValue: jasmine.createSpyObj('Store', ['select']),
          },
        ],
      });

      const svc = TestBed.inject(SyncTriggerService);
      expect(svc.isInitialSyncDoneSync()).toBe(true);
    });

    it('should NOT call setInitialSyncDone when sync is enabled', () => {
      // Default setup has sync enabled
      expect(service.isInitialSyncDoneSync()).toBe(false);
    });
  });

  describe('afterInitialSyncDoneStrict$', () => {
    const createStrictTestService = (opts: {
      syncEnabled: boolean;
      isWaitingForUserInput$?: Observable<boolean>;
    }): SyncTriggerService => {
      const isAllDataLoaded$ = new ReplaySubject<boolean>(1);
      isAllDataLoaded$.next(true);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SyncTriggerService,
          {
            provide: GlobalConfigService,
            useValue: jasmine.createSpyObj('GlobalConfigService', [], {
              cfg$: of({ sync: { isEnabled: opts.syncEnabled } }),
              idle$: of({ isEnableIdleTimeTracking: false }),
            }),
          },
          {
            provide: DataInitStateService,
            useValue: jasmine.createSpyObj('DataInitStateService', [], {
              isAllDataLoadedInitially$: isAllDataLoaded$.asObservable(),
            }),
          },
          {
            provide: IdleService,
            useValue: jasmine.createSpyObj('IdleService', [], {
              isIdle$: of(false),
            }),
          },
          {
            provide: SyncWrapperService,
            useValue: jasmine.createSpyObj('SyncWrapperService', [], {
              syncProviderId$: of(null),
              isWaitingForUserInput$: opts.isWaitingForUserInput$ ?? of(false),
            }),
          },
          {
            provide: Store,
            useValue: jasmine.createSpyObj('Store', ['select']),
          },
        ],
      });

      return TestBed.inject(SyncTriggerService);
    };

    it('should emit true immediately when sync is disabled', fakeAsync(() => {
      const svc = createStrictTestService({ syncEnabled: false });

      let emitted: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (emitted = val));
      tick(0);

      expect(emitted).toBe(true);
    }));

    it('should emit true when setInitialSyncDone(true) is called', fakeAsync(() => {
      const svc = createStrictTestService({ syncEnabled: true });

      let emitted: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (emitted = val));
      tick(0);
      expect(emitted).toBeUndefined();

      svc.setInitialSyncDone(true);
      tick(0);
      expect(emitted).toBe(true);
    }));

    it('should emit true on timeout when no dialog is open', fakeAsync(() => {
      const svc = createStrictTestService({ syncEnabled: true });

      let emitted: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (emitted = val));

      tick(7999);
      expect(emitted).toBeUndefined();

      tick(1);
      expect(emitted).toBe(true);
    }));

    it('should emit true on timeout even when dialog is open', fakeAsync(() => {
      const isWaiting$ = new BehaviorSubject<boolean>(true);
      const svc = createStrictTestService({
        syncEnabled: true,
        isWaitingForUserInput$: isWaiting$,
      });

      let emitted: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (emitted = val));

      tick(7999);
      expect(emitted).toBeUndefined();

      tick(1);
      expect(emitted).toBe(true);
    }));

    it('should emit on manual sync completion before timeout fires', fakeAsync(() => {
      const svc = createStrictTestService({ syncEnabled: true });

      let emitted: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (emitted = val));

      tick(5000);
      expect(emitted).toBeUndefined();

      svc.setInitialSyncDone(true);
      tick(0);
      expect(emitted).toBe(true);
    }));

    it('should replay the cached value to late subscribers', fakeAsync(() => {
      const svc = createStrictTestService({ syncEnabled: false });

      let firstVal: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (firstVal = val));
      tick(0);
      expect(firstVal).toBe(true);

      let secondVal: boolean | undefined;
      svc.afterInitialSyncDoneStrict$.subscribe((val) => (secondVal = val));
      tick(0);
      expect(secondVal).toBe(true);
    }));
  });

  describe('getSyncTrigger$', () => {
    // syncInterval=10000 stays above SYNC_MIN_INTERVAL=5000 so the auditTime
    // path doesn't fire faster than the periodic timer.
    const SYNC_INTERVAL = 10000;
    const DEBOUNCE = 100;

    it('should fire periodically when useIntervalTimer=true (file-based providers)', fakeAsync(() => {
      const emissions: unknown[] = [];
      const sub = service
        .getSyncTrigger$(SYNC_INTERVAL, true)
        .subscribe((v) => emissions.push(v));

      // Periodic timer fires at SYNC_INTERVAL; debounceTime tail adds DEBOUNCE
      tick(SYNC_INTERVAL + DEBOUNCE + 50);
      const afterFirstInterval = emissions.length;
      expect(afterFirstInterval).toBeGreaterThan(0);

      // Second periodic emission after another SYNC_INTERVAL
      tick(SYNC_INTERVAL);
      expect(emissions.length).toBeGreaterThan(afterFirstInterval);

      sub.unsubscribe();
    }));

    it('should NOT fire periodically when useIntervalTimer=false (SuperSync)', fakeAsync(() => {
      const emissions: unknown[] = [];
      const sub = service
        .getSyncTrigger$(SYNC_INTERVAL, false)
        .subscribe((v) => emissions.push(v));

      // After one syncInterval, the audit-time path may emit once.
      tick(SYNC_INTERVAL + DEBOUNCE + 50);
      const afterFirstInterval = emissions.length;

      // After another full syncInterval, no further emissions
      // (auditTime's of(null) source has completed; no periodic timer registered)
      tick(SYNC_INTERVAL);
      expect(emissions.length).toBe(afterFirstInterval);

      sub.unsubscribe();
    }));
  });
});
