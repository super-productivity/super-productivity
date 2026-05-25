import { actionLogger } from '../../util/action-logger';
import { ActionReducer, Action } from '@ngrx/store';
import { Log } from '../../core/log';

export const actionLoggerReducer = <S, A extends Action = Action>(
  reducer: ActionReducer<S, A>,
): ActionReducer<S, A> => {
  return (state: S | undefined, action: A) => {
    // if (environment.production) {
    Log.verbose(
      '[a]' + action.type,
      (action as Action & { payload?: unknown })?.payload || action,
    );
    actionLogger(action as unknown as { type: string; [key: string]: unknown });
    return reducer(state, action);
  };
};
