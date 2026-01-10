import { JiraCfg } from './jira.model';

export const isJiraEnabled = (cfg: JiraCfg): boolean => cfg.isEnabled;
