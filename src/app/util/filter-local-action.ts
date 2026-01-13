import { filter, OperatorFunction } from 'rxjs';
import { Action } from '@ngrx/store';

/**
 * RxJS operator that filters out remote actions from sync.
 *
 * Use this in effects that should only run for local user actions,
 * not for actions replayed from remote sync.
 *
 * @example
 * ```typescript
 * myEffect$ = createEffect(() =>
 *   this._actions$.pipe(
 *     ofType(TaskSharedActions.addTask),
 *     filterLocalAction(),
 *     // ... rest of effect
 *   )
 * );
 * ```
 */
export const filterLocalAction = <T extends Action>(): OperatorFunction<T, T> =>
  filter((action: T) => !(action as any).meta?.isRemote);

/**
 * RxJS operator that filters to only remote actions from sync.
 *
 * Use this in effects that should only run for remote sync actions,
 * not for local user actions.
 *
 * @example
 * ```typescript
 * myEffect$ = createEffect(() =>
 *   this._actions$.pipe(
 *     ofType(TaskSharedActions.moveToArchive),
 *     filterRemoteAction(),
 *     // ... rest of effect
 *   )
 * );
 * ```
 */
export const filterRemoteAction = <T extends Action>(): OperatorFunction<T, T> =>
  filter((action: T) => !!(action as any).meta?.isRemote);
