import { OutlookTasksCfg } from './outlook-tasks.model';

export const isOutlookTasksEnabled = (cfg: OutlookTasksCfg): boolean =>
  !!cfg && cfg.isEnabled && !!cfg.clientId && !!cfg.accessToken;
