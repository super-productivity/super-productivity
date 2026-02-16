import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { GlobalConfigEffects } from './global-config.effects';
import { DateService } from 'src/app/core/date/date.service';
import { LanguageService } from '../../../core/language/language.service';
import { SnackService } from '../../../core/snack/snack.service';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { updateGlobalConfigSection } from './global-config.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';

describe('GlobalConfigEffects', () => {
  let effects: GlobalConfigEffects;
  let actions$: Subject<Action>;
  let dateServiceSpy: jasmine.SpyObj<DateService>;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    dateServiceSpy = jasmine.createSpyObj('DateService', [
      'setStartOfNextDayDiff',
      'todayStr',
    ]);
    dateServiceSpy.todayStr.and.returnValue('2026-02-16');
    dateServiceSpy.startOfNextDayDiff = 0;

    TestBed.configureTestingModule({
      providers: [
        GlobalConfigEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
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

    effects = TestBed.inject(GlobalConfigEffects);
    effects.setStartOfNextDayDiffOnChange.subscribe();
    effects.setStartOfNextDayDiffOnLoad.subscribe();
  });

  describe('setStartOfNextDayDiffOnChange', () => {
    it('should call setStartOfNextDayDiff when startOfNextDay is set to a non-zero value', () => {
      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith(4);
    });

    it('should call setStartOfNextDayDiff when startOfNextDay is set to 0', () => {
      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 0 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith(0);
    });

    it('should not call setStartOfNextDayDiff for other config sections', () => {
      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'keyboard',
          sectionCfg: { globalShowHide: 'Ctrl+Shift+X' },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).not.toHaveBeenCalled();
    });

    it('should dispatch setTodayString with todayStr and startOfNextDayDiffMs', () => {
      dateServiceSpy.startOfNextDayDiff = 14400000;
      let emittedAction: Action | undefined;
      effects.setStartOfNextDayDiffOnChange.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(emittedAction).toEqual(
        AppStateActions.setTodayString({
          todayStr: '2026-02-16',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });
  });

  describe('setStartOfNextDayDiffOnLoad', () => {
    it('should call setStartOfNextDayDiff when loadAllData is dispatched', () => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: { ...DEFAULT_GLOBAL_CONFIG.misc, startOfNextDay: 4 },
            },
          } as any,
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith(4);
    });

    it('should dispatch setTodayString when loadAllData is dispatched', () => {
      dateServiceSpy.startOfNextDayDiff = 14400000;
      let emittedAction: Action | undefined;
      effects.setStartOfNextDayDiffOnLoad.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: { ...DEFAULT_GLOBAL_CONFIG.misc, startOfNextDay: 4 },
            },
          } as any,
        }),
      );

      expect(emittedAction).toEqual(
        AppStateActions.setTodayString({
          todayStr: '2026-02-16',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });
  });
});
