import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';

/**
 * Complete application state snapshot.
 * Used for sync operations and backup/restore.
 */
export interface AppStateSnapshot {
  task: unknown;
  project: unknown;
  tag: unknown;
  globalConfig: unknown;
  note: unknown;
  issueProvider: unknown;
  planner: unknown;
  boards: unknown;
  metric: unknown;
  simpleCounter: unknown;
  taskRepeatCfg: unknown;
  menuTree: unknown;
  timeTracking: unknown;
  pluginUserData: unknown;
  pluginMetadata: unknown;
  reminders: unknown;
  archiveYoung: ArchiveModel;
  archiveOld: ArchiveModel;
}
