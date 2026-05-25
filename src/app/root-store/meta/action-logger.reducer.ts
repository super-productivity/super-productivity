import { actionLogger } from '../../util/action-logger';
import { ActionReducer, Action } from '@ngrx/store';
import { Log } from '../../core/log';

export const actionLoggerReducer = <S, A extends Action = Action>(
  reducer: ActionReducer<S, A>,
): ActionReducer<S, A> => {
  return (state: S | undefined, action: A) => {
    // Log the action TYPE only — payloads/full actions carry user content
    // and the log history is user-exportable. See core/log.ts header / rule #9.
    Log.verbose('[a]' + action.type);
    actionLogger(action as unknown as { type: string; [key: string]: unknown });
    return reducer(state, action);
  };
};
