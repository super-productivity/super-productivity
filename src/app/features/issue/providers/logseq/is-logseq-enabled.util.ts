import { LogseqCfg } from './logseq.model';

export const isLogseqEnabled = (cfg: LogseqCfg): boolean => {
  return !!(cfg?.isEnabled && cfg.apiUrl && cfg.authToken);
};
