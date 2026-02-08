import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { EMPTY, Observable, timer } from 'rxjs';
import { distinctUntilChanged, switchMap, tap, withLatestFrom } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { selectIsDominaModeConfig } from '../../config/store/global-config.reducer';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { speak } from '../../../util/speak';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';

@Injectable()
export class VoiceReminderEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject(Store);

  dominaMode$: Observable<unknown> = createEffect(
    () =>
      this._store$.select(selectIsDominaModeConfig).pipe(
        skipWhileApplyingRemoteOps(),
        distinctUntilChanged(),
        switchMap((cfg) =>
          cfg.isEnabled && cfg.voice
            ? timer(1000, cfg.interval || 10000).pipe(
                withLatestFrom(this._store$.select(selectCurrentTask)),
                tap(([, currentTask]) => {
                  if (currentTask) {
                    let txt = cfg.text.replace('${currentTaskTitle}', currentTask.title);
                    if (txt.length <= 1) {
                      txt = currentTask.title;
                    }
                    if (cfg.voice) {
                      speak(txt, cfg.volume, cfg.voice);
                    }
                  }
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );
}
