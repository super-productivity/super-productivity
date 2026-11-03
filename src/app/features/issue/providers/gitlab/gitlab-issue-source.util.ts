import { GitlabCfg, GitlabIssueSource } from './gitlab.model';

/** Where a GitLab provider reads issues from; a missing value means 'project'. */
export const getGitlabIssueSource = (cfg: GitlabCfg): GitlabIssueSource =>
  cfg.issueSource || 'project';

/** True when the fields the selected source needs are filled in. */
export const isGitlabSourceConfigured = (cfg: GitlabCfg): boolean => {
  switch (getGitlabIssueSource(cfg)) {
    case 'all':
      return true;
    case 'group':
      return !!cfg.group;
    default:
      return !!cfg.project;
  }
};

/** The project or group path a provider reads from, for display; nothing for all projects. */
export const getGitlabSourceLabel = (cfg: GitlabCfg): string | undefined => {
  switch (getGitlabIssueSource(cfg)) {
    case 'all':
      return undefined;
    case 'group':
      return cfg.group || undefined;
    default:
      return cfg.project || undefined;
  }
};

/**
 * The configured project, or null when issues come from a group or all projects
 */
export const getGitlabActiveProject = (cfg: GitlabCfg): string | null =>
  getGitlabIssueSource(cfg) === 'project' ? cfg.project : null;
