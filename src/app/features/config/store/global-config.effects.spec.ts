import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject, Subscription } from 'rxjs';
import { Action } from '@ngrx/store';
import { GlobalConfigEffects } from './global-config.effects';
import { IS_ELECTRON_TOKEN } from './global-config.effects';
import { DateService } from 'src/app/core/date/date.service';
import { LanguageService } from '../../../core/language/language.service';
import { SnackService } from '../../../core/snack/snack.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { updateGlobalConfigSection } from './global-config.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { KeyboardLayoutService } from '../../../core/keyboard-layout/keyboard-layout.service';
import { selectKeyboardConfig } from './global-config.reducer';

describe('GlobalConfigEffects', () => {
  let effects: GlobalConfigEffects;
  let actions$: Subject<Action>;
  let dateServiceSpy: jasmine.SpyObj<DateService>;
  let store: MockStore;
  let keyboardLayoutService: KeyboardLayoutService;
  let originalElectronApi: typeof window.ea | undefined;
  let originalNavigator: Navigator;
  let registerGlobalShortcutsSpy: jasmine.Spy;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    dateServiceSpy = jasmine.createSpyObj('DateService', [
      'setStartOfNextDayDiff',
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateServiceSpy.todayStr.and.returnValue('2026-02-20');
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(0);
    originalNavigator = globalThis.navigator;
    originalElectronApi = window.ea;
    registerGlobalShortcutsSpy = jasmine.createSpy('registerGlobalShortcuts');
    window.ea = {
      ...(window.ea ?? {}),
      registerGlobalShortcuts: registerGlobalShortcutsSpy,
    } as unknown as typeof window.ea;

    TestBed.configureTestingModule({
      providers: [
        GlobalConfigEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        { provide: DateService, useValue: dateServiceSpy },
        {
          provide: LanguageService,
          useValue: { setLng: jasmine.createSpy('setLng') },
        },
        {
          provide: SnackService,
          useValue: { open: jasmine.createSpy('open') },
        },
        {
          provide: UserProfileService,
          useValue: { updateDayIdFromRemote: jasmine.createSpy('updateDayIdFromRemote') },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectAllTasks, []);
    store.overrideSelector(selectKeyboardConfig, DEFAULT_GLOBAL_CONFIG.keyboard);
    keyboardLayoutService = TestBed.inject(KeyboardLayoutService);
    effects = TestBed.inject(GlobalConfigEffects);
    effects.setStartOfNextDayDiffOnLoad.subscribe();
  });

  afterEach(() => {
    store.resetSelectors();
    window.ea = originalElectronApi as typeof window.ea;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    keyboardLayoutService.clear();
  });

  describe('global shortcut registration', () => {
    it('should register global shortcuts with the current keyboard layout snapshot on load', () => {
      keyboardLayoutService.setLayout(new Map([['KeyZ', 'y']]));
      effects.registerGlobalShortcutInitially$.subscribe();

      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              keyboard: {
                ...DEFAULT_GLOBAL_CONFIG.keyboard,
                globalShowHide: 'Meta+Y',
              },
            },
          } as any,
        }),
      );

      expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ globalShowHide: 'Meta+Y' }),
        [['KeyZ', 'y']],
      );
    });

    it('should re-register global shortcuts when the keyboard layout is saved', async () => {
      const keyboardCfg = {
        ...DEFAULT_GLOBAL_CONFIG.keyboard,
        globalShowHide: 'Meta+Y',
      };
      store.overrideSelector(selectKeyboardConfig, keyboardCfg);
      store.refreshState();
      const subscription: Subscription =
        effects.reregisterGlobalShortcutsOnKeyboardLayoutChange$.subscribe();

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          keyboard: {
            getLayoutMap: () => Promise.resolve(new Map([['KeyZ', 'y']])),
          },
        },
        writable: true,
        configurable: true,
      });

      await keyboardLayoutService.saveUserLayout();

      expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(keyboardCfg, [
        ['KeyZ', 'y'],
      ]);
      subscription.unsubscribe();
    });
  });

  describe('setStartOfNextDayDiffOnChange', () => {
    it('should call setStartOfNextDayDiff when startOfNextDay is set to a non-zero value', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });

    it('should call setStartOfNextDayDiff when startOfNextDay is set to 0', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 0 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('00:00', 0);
    });

    it('should not call setStartOfNextDayDiff for other config sections', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'keyboard',
          sectionCfg: { globalShowHide: 'Ctrl+Shift+X' },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).not.toHaveBeenCalled();
      expect(dispatched.length).toBe(0);
    });

    it('should dispatch setTodayString when startOfNextDay changes', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dispatched).toContain(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 0,
        }),
      );
    });

    it('should dispatch updateTasks when todayStr shifts and tasks have old dueDay', () => {
      // First call returns old date, second call (after setStartOfNextDayDiff) returns new date
      dateServiceSpy.todayStr.and.returnValues('2026-02-20', '2026-02-19');

      store.overrideSelector(selectAllTasks, [
        { id: 'task1', dueDay: '2026-02-20' } as any,
        { id: 'task2', dueDay: '2026-02-20' } as any,
        { id: 'task3', dueDay: '2026-02-18' } as any,
      ]);
      store.refreshState();

      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      const updateTasksAction = dispatched.find(
        (a) => a.type === TaskSharedActions.updateTasks.type,
      );
      expect(updateTasksAction).toBeTruthy();
      expect((updateTasksAction as any).tasks).toEqual([
        { id: 'task1', changes: { dueDay: '2026-02-19' } },
        { id: 'task2', changes: { dueDay: '2026-02-19' } },
      ]);
    });

    it('should not dispatch updateTasks when todayStr does not change', () => {
      // Both calls return the same date
      dateServiceSpy.todayStr.and.returnValue('2026-02-20');

      store.overrideSelector(selectAllTasks, [
        { id: 'task1', dueDay: '2026-02-20' } as any,
      ]);
      store.refreshState();

      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 0 },
        }),
      );

      const updateTasksAction = dispatched.find(
        (a) => a.type === TaskSharedActions.updateTasks.type,
      );
      expect(updateTasksAction).toBeUndefined();
    });

    it('should dispatch setTodayString with todayStr and startOfNextDayDiffMs', () => {
      dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(14400000);
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((action) => {
        dispatched.push(action);
      });

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dispatched).toContain(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });

    it('should normalize invalid startOfNextDayTime before updating DateService', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: {
            startOfNextDay: 4,
            startOfNextDayTime: '24:00',
          },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });
  });

  describe('setStartOfNextDayDiffOnLoad', () => {
    it('should call setStartOfNextDayDiff when loadAllData is dispatched', () => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: undefined,
              },
            },
          } as any,
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });

    it('should dispatch setTodayString when loadAllData is dispatched', () => {
      dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(14400000);
      let emittedAction: Action | undefined;
      effects.setStartOfNextDayDiffOnLoad.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: undefined,
              },
            },
          } as any,
        }),
      );

      expect(emittedAction).toEqual(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });

    it('should normalize invalid loaded startOfNextDayTime before updating DateService', () => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: '24:00',
              },
            },
          } as any,
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });
  });
});
