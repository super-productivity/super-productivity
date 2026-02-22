import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import {
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { Action, Store } from '@ngrx/store';
import { IS_ELECTRON } from '../../../app.constants';
import { T } from '../../../t.const';
import { LanguageService } from '../../../core/language/language.service';
import { DateService } from '../../../core/date/date.service';
import { SnackService } from '../../../core/snack/snack.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { KeyboardConfig } from '../keyboard-config.model';
import { updateGlobalConfigSection } from './global-config.actions';
import {
  selectConfigFeatureState,
  selectLocalizationConfig,
} from './global-config.reducer';
import { AppFeaturesConfig, MiscConfig } from '../global-config.model';
import { UserProfileService } from '../../user-profile/user-profile.service';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { selectAllTasks } from '../../tasks/store/task.selectors';

@Injectable()
export class GlobalConfigEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _languageService = inject(LanguageService);
  private _dateService = inject(DateService);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _userProfileService = inject(UserProfileService);

  snackUpdate$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        tap(({ sectionKey, sectionCfg, isSkipSnack }) => {
          const isPublicSection = sectionKey.charAt(0) !== '_';
          const isPublicPropUpdated = Object.keys(sectionCfg).find(
            (key) => key.charAt(0) !== '_',
          );
          if (isPublicPropUpdated && isPublicSection && !isSkipSnack) {
            this._snackService.open({
              type: 'SUCCESS',
              msg: T.F.CONFIG.S.UPDATE_SECTION,
              translateParams: { sectionKey },
            });
          }
        }),
      ),
    { dispatch: false },
  );

  updateGlobalShortcut$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter(({ sectionKey, sectionCfg }) => IS_ELECTRON && sectionKey === 'keyboard'),
        tap(({ sectionKey, sectionCfg }) => {
          const keyboardCfg: KeyboardConfig = sectionCfg as KeyboardConfig;
          window.ea.registerGlobalShortcuts(keyboardCfg);
        }),
      ),
    { dispatch: false },
  );

  registerGlobalShortcutInitially$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(loadAllData),
        filter(() => IS_ELECTRON),
        tap((action) => {
          const appDataComplete = action.appDataComplete;
          const keyboardCfg: KeyboardConfig = (
            appDataComplete.globalConfig || DEFAULT_GLOBAL_CONFIG
          ).keyboard;
          window.ea.registerGlobalShortcuts(keyboardCfg);
        }),
      ),
    { dispatch: false },
  );

  // Selector-based effect to apply language from state.
  // This fires on initial load, local changes, AND remote sync.
  // Intentional: UI config should apply from any source, dispatch: false
  applyLanguageFromState$ = createEffect(
    () =>
      this._store.select(selectLocalizationConfig).pipe(
        map((config) => config.lng),
        distinctUntilChanged(),
        tap((lng) => {
          if (lng === undefined) {
            // Initial state - try autoswitch first, then detect browser language
            const autoswitched = this._languageService.tryAutoswitch();
            if (!autoswitched) this._languageService.setLng();
          } else {
            this._languageService.setLng(lng);
          }
        }),
      ),
    { dispatch: false },
  );

  setStartOfNextDayDiffOnChange = createEffect(() =>
    this._actions$.pipe(
      ofType(updateGlobalConfigSection),
      filter(({ sectionKey }) => sectionKey === 'misc'),
      filter(
        ({ sectionCfg }) =>
          sectionCfg && typeof (sectionCfg as MiscConfig).startOfNextDay === 'number',
      ),
      withLatestFrom(this._store.select(selectAllTasks)),
      switchMap(([{ sectionCfg }, allTasks]) => {
        const oldTodayStr = this._dateService.todayStr();
        this._dateService.setStartOfNextDayDiff(
          (sectionCfg as MiscConfig).startOfNextDay,
        );
        const newTodayStr = this._dateService.todayStr();

        const actions: Action[] = [
          AppStateActions.setTodayString({
            todayStr: newTodayStr,
            startOfNextDayDiffMs: this._dateService.startOfNextDayDiff,
          }),
        ];

        // Migrate active task dueDays so "today" tasks stay "today" after offset change.
        // Archived tasks are intentionally excluded — their dueDay is historical.
        if (oldTodayStr !== newTodayStr) {
          const taskUpdates = allTasks
            .filter((t) => t.dueDay === oldTodayStr)
            .map((t) => ({ id: t.id, changes: { dueDay: newTodayStr } }));

          if (taskUpdates.length > 0) {
            actions.push(TaskSharedActions.updateTasks({ tasks: taskUpdates }));
          }
        }

        return actions;
      }),
    ),
  );

  setStartOfNextDayDiffOnLoad = createEffect(() =>
    this._actions$.pipe(
      ofType(loadAllData),
      tap(({ appDataComplete }) => {
        const cfg = appDataComplete.globalConfig || DEFAULT_GLOBAL_CONFIG;
        const startOfNextDay = cfg && cfg.misc && cfg.misc.startOfNextDay;
        this._dateService.setStartOfNextDayDiff(startOfNextDay);
      }),
      map(() =>
        AppStateActions.setTodayString({
          todayStr: this._dateService.todayStr(),
          startOfNextDayDiffMs: this._dateService.startOfNextDayDiff,
        }),
      ),
    ),
  );

  notifyElectronAboutCfgChange =
    IS_ELECTRON &&
    createEffect(
      () =>
        this._actions$.pipe(
          ofType(updateGlobalConfigSection),
          withLatestFrom(this._store.select(selectConfigFeatureState)),
          tap(([action, globalConfig]) => {
            // Send the entire settings object to electron for overlay initialization
            window.ea.sendSettingsUpdate(globalConfig);
          }),
        ),
      { dispatch: false },
    );

  notifyElectronAboutCfgChangeInitially =
    IS_ELECTRON &&
    createEffect(
      () =>
        this._actions$.pipe(
          ofType(loadAllData),
          tap(({ appDataComplete }) => {
            const cfg = appDataComplete.globalConfig || DEFAULT_GLOBAL_CONFIG;
            // Send initial settings to electron for overlay initialization
            window.ea.sendSettingsUpdate(cfg);
          }),
        ),
      { dispatch: false },
    );

  // Handle user profiles being enabled/disabled
  handleUserProfilesToggle = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateGlobalConfigSection),
        filter(({ sectionKey, sectionCfg }) => sectionKey === 'appFeatures'),
        filter(
          ({ sectionCfg }) =>
            sectionCfg &&
            (sectionCfg as AppFeaturesConfig).isEnableUserProfiles !== undefined,
        ),
        tap(({ sectionCfg }) => {
          const isEnabled = (sectionCfg as AppFeaturesConfig).isEnableUserProfiles;
          const wasEnabled =
            typeof localStorage !== 'undefined' &&
            localStorage.getItem('sp_user_profiles_enabled') === 'true';

          if (isEnabled === wasEnabled) {
            // No change, skip
            return;
          }

          // Update localStorage flag for fast startup check
          if (typeof localStorage !== 'undefined') {
            if (isEnabled) {
              localStorage.setItem('sp_user_profiles_enabled', 'true');

              // When enabling for the first time, trigger migration
              this._userProfileService
                .migrateOnFirstEnable()
                .then(() => {
                  this._snackService.open({
                    type: 'SUCCESS',
                    msg: 'User profiles enabled. Reloading app...',
                  });
                  setTimeout(() => window.location.reload(), 1000);
                })
                .catch((err) => {
                  console.error('Failed to migrate user profiles:', err);
                  this._snackService.open({
                    type: 'ERROR',
                    msg: 'Failed to enable user profiles. Please try again.',
                  });
                });
            } else {
              localStorage.removeItem('sp_user_profiles_enabled');
            }
          }
        }),
      ),
    { dispatch: false },
  );
}
