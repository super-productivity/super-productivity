import { Log } from '../core/log';

const NUMBER_OF_ACTIONS_TO_SAVE = 30;

// Keep action log in memory only
const actionLog: string[] = [];
let beforeLastErrorLog: string[] = [];

export const actionLogger = (action: { type: string; [key: string]: unknown }): void => {
  if (action.type.indexOf('@ngrx') === 0) {
    return;
  }

  if (actionLog.length >= NUMBER_OF_ACTIONS_TO_SAVE) {
    actionLog.shift();
  }
  const last = actionLog[actionLog.length - 1];

  // avoid logs with all the same action
  if (last && last.includes(action.type)) {
    const m = last.match(/\((\d+)\)$/);
    if (m && +m[1] > 0) {
      actionLog[actionLog.length - 1] = `${Date.now()}: ${action.type} (${+m[1] + 1})`;
    } else {
      actionLog[actionLog.length - 1] = `${Date.now()}: ${action.type} (2)`;
    }
  } else {
    actionLog.push(`${Date.now()}: ${action.type}`);
  }
};

export const saveBeforeLastErrorActionLog = (): void => {
  beforeLastErrorLog = [...actionLog];
  // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
  Log.log('Last actions before error:', beforeLastErrorLog);
};

export const getBeforeLastErrorActionLog = (): string[] => {
  return beforeLastErrorLog;
};
