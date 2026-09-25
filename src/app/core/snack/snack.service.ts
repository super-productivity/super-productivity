import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { SnackParams } from './snack.model';
import { Observable, Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';
import { DEFAULT_SNACK_CFG } from './snack.const';
import { SnackCustomComponent } from './snack-custom/snack-custom.component';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar, MatSnackBarRef, SimpleSnackBar } from '@angular/material/snack-bar';
import { ofType } from '@ngrx/effects';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { setActiveWorkContext } from '../../features/work-context/store/work-context.actions';
import { debounce } from '../../util/decorators';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

@Injectable({
  providedIn: 'root',
})
export class SnackService {
  private _store$ = inject(Store);
  private _translateService = inject(TranslateService);
  private _actions$ = inject(LOCAL_ACTIONS);
  private _matSnackBar = inject(MatSnackBar);

  private _ref?: MatSnackBarRef<SnackCustomComponent | SimpleSnackBar>;
  private _hasPendingPersistentAction = false;

  constructor() {
    const _onWorkContextChange$: Observable<unknown> = this._actions$.pipe(
      ofType(setActiveWorkContext),
    );
    _onWorkContextChange$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.close();
    });
  }

  open(params: SnackParams | string): void {
    if (typeof params === 'string') {
      params = { msg: params };
    }
    const isPersistentAction = !!(params.actionStr && params.config?.duration === 0);
    // A sticky recovery/update action must survive unrelated success, info and
    // error feedback in the app's single snack slot. Another sticky actionable
    // snack may still replace it intentionally.
    if (this._hasPendingPersistentAction && !isPersistentAction) {
      return;
    }
    // Track a persistent recovery action (a sticky, actionable snack)
    // synchronously, before the debounced render, so an immediate follow-up
    // check (e.g. the header's post-sync success feedback) cannot unknowingly
    // replace it. `_openSnack` is debounced trailing-edge, so this last-writer
    // value matches the snack it will actually render — including the case
    // where a non-persistent snack supersedes a persistent one.
    this._hasPendingPersistentAction = isPersistentAction;
    this._openSnack(params);
  }

  hasPendingPersistentAction(): boolean {
    return this._hasPendingPersistentAction;
  }

  close(): void {
    this._hasPendingPersistentAction = false;
    if (this._ref) {
      this._ref.dismiss();
    }
  }

  // ERROR/WARNING snacks scale with message length so long messages stay readable.
  private _getDefaultDuration(type: SnackParams['type'], msg: unknown): number {
    if (type !== 'ERROR' && type !== 'WARNING') {
      return DEFAULT_SNACK_CFG.duration;
    }
    const length = typeof msg === 'string' ? msg.length : 0;
    return Math.min(Math.max(10000, length * 90), 30000);
  }

  @debounce(100)
  private _openSnack(params: SnackParams): void {
    const _destroy$: Subject<boolean> = new Subject<boolean>();
    const destroySubs = (): void => {
      _destroy$.next(true);
      _destroy$.unsubscribe();
    };
    const {
      msg,
      actionStr,
      actionId,
      actionPayload,
      config,
      type,
      isSkipTranslate,
      translateParams = {},
      showWhile$,
      promise,
      isSpinner,
    } = params;

    const translatedMsg = isSkipTranslate
      ? msg
      : typeof (msg as unknown) === 'string' &&
        this._translateService.instant(msg, translateParams);

    const cfg = {
      ...DEFAULT_SNACK_CFG,
      duration: this._getDefaultDuration(type, translatedMsg),
      ...config,
      data: {
        ...params,
        msg: translatedMsg,
      },
    };

    if (showWhile$ || promise || isSpinner) {
      // TODO check if still needed
      (cfg as { panelClass: string }).panelClass = 'polling-snack';
    }

    switch (type) {
      case 'ERROR':
      case 'CUSTOM':
      case 'SUCCESS':
      default: {
        // Opening snackbar directly without NgZone
        this._ref = this._matSnackBar.openFromComponent(SnackCustomComponent, cfg);
        break;
      }
    }

    // The pending-persistent-action flag is set authoritatively in open()
    // before this debounced render. Here we only clear it once this specific
    // snack is dismissed (guarded so a newer snack's flag isn't cleared).
    const openedRef = this._ref;
    openedRef
      ?.afterDismissed()
      .pipe(take(1))
      .subscribe(() => {
        if (this._ref === openedRef) {
          this._hasPendingPersistentAction = false;
        }
      });

    if (actionStr && openedRef) {
      openedRef
        .onAction()
        .pipe(take(1))
        .subscribe(() => {
          if (this._ref === openedRef) {
            this._hasPendingPersistentAction = false;
          }
        });
    }

    if (actionStr && actionId && this._ref) {
      this._ref
        .onAction()
        .pipe(takeUntil(_destroy$))
        .subscribe(() => {
          this._store$.dispatch({
            type: actionId,
            payload: actionPayload,
          });
          destroySubs();
        });
      this._ref
        .afterDismissed()
        .pipe(takeUntil(_destroy$))
        .subscribe(() => {
          destroySubs();
        });
    }
  }
}
