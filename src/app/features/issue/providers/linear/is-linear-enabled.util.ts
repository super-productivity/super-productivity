import { LinearCfg } from './linear.model';

export const isLinearEnabled = (cfg: LinearCfg): boolean =>
  !!cfg && cfg.isEnabled && !!cfg.apiKey;
