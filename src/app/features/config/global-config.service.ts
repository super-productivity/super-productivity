import { Injectable, inject, Signal } from '@angular/core';
import { select, Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { updateGlobalConfigSection } from './store/global-config.actions';
import { Observable } from 'rxjs';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import {
  EvaluationConfig,
  GlobalConfigSectionKey,
  GlobalConfigState,
  GlobalSectionConfig,
  IdleConfig,
  LocalizationConfig,
  MiscConfig,
  PomodoroConfig,
  ScheduleConfig,
  ShortSyntaxConfig,
  SoundConfig,
  SyncConfig,
  TakeABreakConfig,
  TasksConfig,
} from './global-config.model';
import {
  selectConfigFeatureState,
  selectEvaluationConfig,
  selectIdleConfig,
  selectLocalizationConfig,
  selectMiscConfig,
  selectPomodoroConfig,
  selectShortSyntaxConfig,
  selectSoundConfig,
  selectSyncConfig,
  selectTakeABreakConfig,
  selectTasksConfig,
  selectTimelineConfig,
} from './store/global-config.reducer';
import { distinctUntilChanged, shareReplay } from 'rxjs/operators';
import { distinctUntilChangedObject } from '../../util/distinct-until-changed-object';

@Injectable({
  providedIn: 'root',
})
export class GlobalConfigService {
  private readonly _store = inject<Store<any>>(Store);

  // Keep observables for backward compatibility
  cfg$: Observable<GlobalConfigState> = this._store.pipe(
    select(selectConfigFeatureState),
    distinctUntilChanged(distinctUntilChangedObject),
    shareReplay(1),
  );

  tasks$: Observable<TasksConfig> = this._store.pipe(
    select(selectTasksConfig),
    shareReplay(1),
  );

  localization$: Observable<LocalizationConfig> = this._store.pipe(
    select(selectLocalizationConfig),
    shareReplay(1),
  );

  misc$: Observable<MiscConfig> = this._store.pipe(
    select(selectMiscConfig),
    shareReplay(1),
  );

  shortSyntax$: Observable<ShortSyntaxConfig> = this._store.pipe(
    select(selectShortSyntaxConfig),
  );

  sound$: Observable<SoundConfig> = this._store.pipe(
    select(selectSoundConfig),
    shareReplay(1),
  );

  evaluation$: Observable<EvaluationConfig> = this._store.pipe(
    select(selectEvaluationConfig),
  );

  idle$: Observable<IdleConfig> = this._store.pipe(
    select(selectIdleConfig),
    shareReplay(1),
  );

  sync$: Observable<SyncConfig> = this._store.pipe(
    select(selectSyncConfig),
    shareReplay(1),
  );

  takeABreak$: Observable<TakeABreakConfig> = this._store.pipe(
    select(selectTakeABreakConfig),
    shareReplay(1),
  );

  pomodoroConfig$: Observable<PomodoroConfig> = this._store.pipe(
    select(selectPomodoroConfig),
    shareReplay(1),
  );

  timelineCfg$: Observable<ScheduleConfig> = this._store.pipe(
    select(selectTimelineConfig),
  );

  // Signal versions of the properties
  readonly cfg: Signal<GlobalConfigState | undefined> = toSignal(this.cfg$, {
    initialValue: undefined,
  });
  readonly localization: Signal<LocalizationConfig | undefined> = toSignal(
    this.localization$,
    { initialValue: undefined },
  );
  readonly tasks: Signal<TasksConfig | undefined> = toSignal(this.tasks$, {
    initialValue: undefined,
  });
  readonly misc: Signal<MiscConfig | undefined> = toSignal(this.misc$, {
    initialValue: undefined,
  });
  readonly shortSyntax: Signal<ShortSyntaxConfig | undefined> = toSignal(
    this.shortSyntax$,
    { initialValue: undefined },
  );
  readonly sound: Signal<SoundConfig | undefined> = toSignal(this.sound$, {
    initialValue: undefined,
  });
  readonly evaluation: Signal<EvaluationConfig | undefined> = toSignal(this.evaluation$, {
    initialValue: undefined,
  });
  readonly idle: Signal<IdleConfig | undefined> = toSignal(this.idle$, {
    initialValue: undefined,
  });
  readonly sync: Signal<SyncConfig | undefined> = toSignal(this.sync$, {
    initialValue: undefined,
  });
  readonly takeABreak: Signal<TakeABreakConfig | undefined> = toSignal(this.takeABreak$, {
    initialValue: undefined,
  });
  readonly pomodoroConfig: Signal<PomodoroConfig | undefined> = toSignal(
    this.pomodoroConfig$,
    {
      initialValue: DEFAULT_GLOBAL_CONFIG.pomodoro,
    },
  );
  readonly timelineCfg: Signal<ScheduleConfig | undefined> = toSignal(this.timelineCfg$, {
    initialValue: undefined,
  });

  updateSection(
    sectionKey: GlobalConfigSectionKey,
    sectionCfg: Partial<GlobalSectionConfig>,
    isSkipSnack?: boolean,
  ): void {
    this._store.dispatch(
      updateGlobalConfigSection({
        sectionKey,
        sectionCfg,
        isSkipSnack,
      }),
    );
  }
}
