import { actionLogger } from '../../util/action-logger';
import { ActionReducer, Action } from '@ngrx/store';
import { Log } from '../../core/log';
import { isBulkReplayLoggingSuppressed } from '../../util/bulk-replay-log-guard';

export const actionLoggerReducer = <S, A extends Action = Action>(
  reducer: ActionReducer<S, A>,
): ActionReducer<S, A> => {
  return (state: S | undefined, action: A) => {
    // Log the action TYPE only — payloads/full actions carry user content
    // and the log history is user-exportable. See core/log.ts header / rule #9.
    //
    // Skip the per-op console line during a bulk-replay pass: one
    // `bulkApplyOperations` dispatch runs this reducer once per op, which would
    // otherwise print one `[a]<type>` line per op (hundreds for a hydration
    // replay). The caller already logs a single "applying N ops" summary. The
    // in-memory ring buffer below is still fed (it dedupes) for error reports.
    if (!isBulkReplayLoggingSuppressed()) {
      Log.verbose('[a]' + action.type);
    }
    actionLogger(action as unknown as { type: string; [key: string]: unknown });
    return reducer(state, action);
  };
};
