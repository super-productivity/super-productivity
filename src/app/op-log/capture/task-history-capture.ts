import { Action } from '@ngrx/store';
import { TaskHistoryEnvelope } from '../../features/tasks/task-history/task-history.model';
import { uuidv7 } from '../../util/uuid-v7';

/** Per-dispatch data; action objects themselves may be frozen by NgRx. */
export interface TaskHistoryCapture {
  operationId: string;
  occurredAt: number;
  envelope?: TaskHistoryEnvelope;
}

const active = new WeakMap<Action, TaskHistoryCapture>();
const pending = new WeakMap<Action, TaskHistoryCapture[]>();

export const getActiveTaskHistoryCapture = (
  action: Action,
): TaskHistoryCapture | undefined => active.get(action);

export const peekTaskHistoryCapture = (action: Action): TaskHistoryCapture | undefined =>
  pending.get(action)?.[0];

export const releaseTaskHistoryCapture = (action: Action): void => {
  const captures = pending.get(action);
  captures?.shift();
  if (!captures?.length) pending.delete(action);
};

/** Nondeterministic metadata is allocated once at the local dispatch boundary. */
export const withTaskHistoryCapture = <S>(action: Action, reduce: () => S): S => {
  const capture: TaskHistoryCapture = { operationId: uuidv7(), occurredAt: Date.now() };
  active.set(action, capture);
  try {
    const state = reduce();
    const captures = pending.get(action) ?? [];
    captures.push(capture);
    pending.set(action, captures);
    return state;
  } finally {
    active.delete(action);
  }
};
