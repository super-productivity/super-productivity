export type TrackAction = 'none' | 'suggest' | 'switch';

export interface DecideInput {
  /** Task the foreground window has pointed at for the full dwell time. */
  matchId: string;
  /** `undefined` until the first task-change hook: the plugin may load mid-session. */
  currentTaskId: string | null | undefined;
  /** Task this plugin last started, as long as the user has not changed it since. */
  autoStartedId: string | null;
  isAutoSwitch: boolean;
}

/**
 * Auto-switch never overrides a task the user picked: it only acts when nothing is
 * tracked or the running task was started by this plugin. Otherwise it suggests.
 */
export const decideAction = ({
  matchId,
  currentTaskId,
  autoStartedId,
  isAutoSwitch,
}: DecideInput): TrackAction => {
  if (matchId === currentTaskId) return 'none';
  const isOwnedByPlugin = currentTaskId === null || currentTaskId === autoStartedId;
  return isAutoSwitch && isOwnedByPlugin ? 'switch' : 'suggest';
};
