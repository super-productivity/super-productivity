import { NextcloudDeckCfg } from './nextcloud-deck.model';

export const isNextcloudDeckEnabled = (cfg: NextcloudDeckCfg): boolean =>
  !!cfg && cfg.isEnabled && !!cfg.nextcloudBaseUrl && !!cfg.username && !!cfg.password;
