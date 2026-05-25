import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { SnackParams } from './snack.model';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DEFAULT_SNACK_CFG } from './snack.const';
import { SnackCustomComponent } from './snack-custom/snack-custom.component';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar, MatSnackBarRef, SimpleSnackBar } from '@angular/material/snack-bar';
import { ofType } from '@ngrx/effects';
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
    this._openSnack(params);
  }

  close(): void {
    if (this._ref) {
      this._ref.dismiss();
    }
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

    const cfg = {
      ...DEFAULT_SNACK_CFG,
      duration: type === 'ERROR' ? 8000 : DEFAULT_SNACK_CFG.duration,
      ...config,
      data: {
        ...params,
        msg: isSkipTranslate
          ? msg
          : typeof (msg as unknown) === 'string' &&
            this._translateService.instant(msg, translateParams),
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
