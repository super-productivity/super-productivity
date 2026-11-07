import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SYNC_TRIGGER_ANDROID_EVENTS, SyncTriggerService } from './sync-trigger.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IdleService } from '../../features/idle/idle.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { Store } from '@ngrx/store';
import { BehaviorSubject, merge, Observable, of, ReplaySubject, Subject } from 'rxjs';
import { mapTo } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { SyncLog } from '../../core/log';

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

  describe('getSyncTrigger$ on Android', () => {
    const SYNC_INTERVAL = 60_000;
    let onResume$: ReplaySubject<void>;
    let onPause$: Subject<void>;
    let androidService: SyncTriggerService;
    let triggers: string[];

    beforeEach(() => {
      // Same shapes as android-interface.ts
      onResume$ = new ReplaySubject(1);
      onPause$ = new Subject();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SyncTriggerService,
          { provide: GlobalConfigService, useValue: globalConfigService },
          { provide: DataInitStateService, useValue: dataInitStateService },
          { provide: IdleService, useValue: idleService },
          { provide: SyncWrapperService, useValue: syncWrapperService },
          { provide: Store, useValue: store },
          { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: true },
          {
            provide: SYNC_TRIGGER_ANDROID_EVENTS,
            useValue: {
              onResume$,
              onPause$,
              isInBackground$: merge(
                onResume$.pipe(mapTo(false)),
                onPause$.pipe(mapTo(true)),
              ),
            },
          },
        ],
      });
      androidService = TestBed.inject(SyncTriggerService);

      // Immediate triggers are logged by label before any debounce/audit merging.
      triggers = [];
      spyOn(SyncLog, 'log').and.callFake((msg: unknown, label?: unknown) => {
        if (msg === 'immediate sync trigger') {
          triggers.push(label as string);
        }
      });
    });

    const count = (label: string): number => triggers.filter((t) => t === label).length;

    it('fires on the interval in the foreground for file-based providers (#10685)', fakeAsync(() => {
      const sub = androidService.getSyncTrigger$(SYNC_INTERVAL, true).subscribe();
      onResume$.next();
      tick(30 * SYNC_INTERVAL);

      expect(count('I_RESUME_APP')).toBe(1);
      expect(count('I_INTERVAL_TIMER')).toBe(30);
      expect(count('I_MOBILE_ONLY_BACKGROUND_TIMER')).toBe(0);
      sub.unsubscribe();
    }));

    it('fires on the interval before any resume has arrived', fakeAsync(() => {
      const sub = androidService.getSyncTrigger$(SYNC_INTERVAL, true).subscribe();
      tick(3 * SYNC_INTERVAL);

      expect(count('I_INTERVAL_TIMER')).toBe(3);
      sub.unsubscribe();
    }));

    it('hands over to the unchanged background timer while paused, and back on resume', fakeAsync(() => {
      const sub = androidService.getSyncTrigger$(SYNC_INTERVAL, true).subscribe();
      onResume$.next();
      tick(SYNC_INTERVAL / 2);
      onPause$.next();
      tick(3 * SYNC_INTERVAL);

      expect(count('I_INTERVAL_TIMER')).toBe(0);
      expect(count('I_MOBILE_ONLY_BACKGROUND_TIMER')).toBe(3);

      tick(20_000); // leave the resume throttle window
      onResume$.next();
      tick(2 * SYNC_INTERVAL);

      expect(count('I_INTERVAL_TIMER')).toBe(2);
      expect(count('I_MOBILE_ONLY_BACKGROUND_TIMER')).toBe(3);
      sub.unsubscribe();
    }));

    it('does not poll in the foreground for SuperSync (useIntervalTimer=false)', fakeAsync(() => {
      const sub = androidService.getSyncTrigger$(SYNC_INTERVAL, false).subscribe();
      onResume$.next();
      tick(30 * SYNC_INTERVAL);

      expect(triggers).toEqual(['I_RESUME_APP']);
      sub.unsubscribe();
    }));

    it('opens the sync window on the injected resume event', () => {
      const openSpy = spyOn(TestBed.inject(HydrationStateService), 'openSyncWindow');
      onResume$.next();
      expect(openSpy).toHaveBeenCalled();
    });
  });

  // Regression for the wake-up race: the visibilitychange listener must open
  // the sync window synchronously. Any debounce/throttle in front would let
  // the DAY_CHANGE → TODAY_TAG-repair cascade fire on stale state first.
  it('opens sync window synchronously on visibilitychange to visible', () => {
    const isAllDataLoaded$ = new ReplaySubject<boolean>(1);
    isAllDataLoaded$.next(true);
    const hydrationSpy = jasmine.createSpyObj<HydrationStateService>(
      'HydrationStateService',
      ['openSyncWindow', 'isInSyncWindow', 'isApplyingRemoteOps'],
    );
    // spyOnProperty is auto-restored per spec — no Document.prototype mutation.
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SyncTriggerService,
        {
          provide: GlobalConfigService,
          useValue: jasmine.createSpyObj('GlobalConfigService', [], {
            cfg$: of({ sync: { isEnabled: true } }),
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
        { provide: HydrationStateService, useValue: hydrationSpy },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['select']) },
      ],
    });
    TestBed.inject(SyncTriggerService);
    hydrationSpy.openSyncWindow.calls.reset();

    const before = hydrationSpy.openSyncWindow.calls.count();
    document.dispatchEvent(new Event('visibilitychange'));
    const after = hydrationSpy.openSyncWindow.calls.count();

    // Synchronous: a debounceTime/throttleTime regression would yield 0 here.
    expect(after - before).toBe(1);
  });
});
