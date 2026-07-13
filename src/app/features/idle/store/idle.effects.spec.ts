import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { IdleEffects } from './idle.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { ChromeExtensionInterfaceService } from '../../../core/chrome-extension-interface/chrome-extension-interface.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskService } from '../../tasks/task.service';
import { MatDialog } from '@angular/material/dialog';
import { UiHelperService } from '../../ui-helper/ui-helper.service';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { DateService } from '../../../core/date/date.service';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import {
  selectIdleConfig,
} from '../../config/store/global-config.reducer';
import { selectIsSessionRunning } from '../../focus-mode/store/focus-mode.selectors';
import { selectIsIdle } from './idle.selectors';
import { triggerIdle } from './idle.actions';

describe('IdleEffects', () => {
  let effects: IdleEffects;
  let store: MockStore;
  let chromeInterfaceMock: {
    onReady$: Subject<void>;
    addEventListener: jasmine.Spy;
  };
  let idleCallback: ((ev: Event, data?: unknown) => void) | null;

  const setup = (overrides?: {
    isSuppressIdleDuringFocusMode?: boolean;
    isFocusSessionRunning?: boolean;
  }): void => {
    idleCallback = null;
    const isSuppress = overrides?.isSuppressIdleDuringFocusMode ?? false;
    const isSessionRunning = overrides?.isFocusSessionRunning ?? false;

    const onReady$ = new Subject<void>();
    chromeInterfaceMock = {
      onReady$: onReady$ as unknown as Observable<void>,
      addEventListener: jasmine
        .createSpy('addEventListener')
        .and.callFake((event: string, cb: (ev: Event, data?: unknown) => void) => {
          if (event === IPC.IDLE_TIME) {
            idleCallback = cb;
          }
        }),
    };

    const dataInitStateMock = {
      isAllDataLoadedInitially$: new BehaviorSubject<boolean>(true),
    };

    const taskServiceMock = {
      currentTaskId: jasmine.createSpy('currentTaskId').and.returnValue('task-1'),
    };

    TestBed.configureTestingModule({
      providers: [
        IdleEffects,
        provideMockStore({
          selectors: [
            {
              selector: selectIdleConfig,
              value: {
                isEnableIdleTimeTracking: true,
                isSuppressIdleDuringFocusMode: isSuppress,
                isOnlyOpenIdleWhenCurrentTask: false,
                minIdleTime: 60000,
              },
            },
            { selector: selectIsSessionRunning, value: isSessionRunning },
            { selector: selectIsIdle, value: false },
          ],
        }),
        { provide: DataInitStateService, useValue: dataInitStateMock },
        {
          provide: ChromeExtensionInterfaceService,
          useValue: chromeInterfaceMock,
        },
        { provide: WorkContextService, useValue: {} as any },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: MatDialog, useValue: {} as any },
        { provide: UiHelperService, useValue: {} as any },
        {
          provide: SimpleCounterService,
          useValue: { enabledSimpleStopWatchCounters$: new BehaviorSubject([]) },
        },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-07-13' },
        },
      ],
    });

    effects = TestBed.inject(IdleEffects);
    store = TestBed.inject(MockStore);

    // Kick off the Chrome extension interface so _triggerIdleApis$ activates
    onReady$.next();
    onReady$.complete();
  };

  afterEach(() => {
    store?.resetSelectors();
  });

  describe('triggerIdleWhenEnabled$', () => {
    it('should suppress idle when isSuppressIdleDuringFocusMode is true and a work session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: true, isFocusSessionRunning: true });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      // Fire idle time above minIdleTime (60000ms)
      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        // Guard returns EMPTY so no triggerIdle action should be emitted
        expect(emitted.length).toBe(0);
        done();
      }, 200);
    });

    it('should NOT suppress idle when isSuppressIdleDuringFocusMode is true but no session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: true, isFocusSessionRunning: false });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toEqual(
          triggerIdle({ idleTime: 120000 }),
        );
        done();
      }, 200);
    });

    it('should NOT suppress idle when isSuppressIdleDuringFocusMode is false even if session is running', (done) => {
      setup({ isSuppressIdleDuringFocusMode: false, isFocusSessionRunning: true });

      const emitted: unknown[] = [];
      const sub = effects.triggerIdleWhenEnabled$.subscribe({
        next: (action) => emitted.push(action),
        error: (err) => {
          sub.unsubscribe();
          done.fail(err);
        },
      });

      if (idleCallback) {
        idleCallback(null as unknown as Event, 120000);
      }

      setTimeout(() => {
        sub.unsubscribe();
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toEqual(
          triggerIdle({ idleTime: 120000 }),
        );
        done();
      }, 200);
    });
  });
});
