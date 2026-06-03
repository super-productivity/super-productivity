import { AppFeaturesConfig } from './global-config.model';
import { DefaultStartPage } from './default-start-page.const';
import { Project } from '../project/project.model';
import { TODAY_TAG } from '../tag/tag.const';
import { INBOX_PROJECT } from '../project/project.const';

/**
 * Resolve the configured default start page to a route path.
 *
 * Shared by `DefaultStartPageGuard` (boot redirect) and
 * `AndroidBackButtonService` (back → start destination) so the two never drift.
 *
 * @param startProject the project referenced by a project-id start page,
 *   already looked up by the caller (or `undefined` for built-in start pages).
 *   A missing, archived, or hidden-from-menu project falls back to Today —
 *   the same cases where the start-page dropdown omits it.
 */
export const getStartPageUrlPath = (
  defaultStartPage: number | string | undefined,
  appFeatures: AppFeaturesConfig,
  startProject: Project | undefined,
): string => {
  const todayUrl = `/tag/${TODAY_TAG.id}/tasks`;

  if (typeof defaultStartPage === 'string' && defaultStartPage.length > 0) {
    // Build the path from the validated project's own id (not the raw config
    // string) so the helper is self-validating and never echoes an unvetted
    // value into the route.
    return startProject && !startProject.isArchived && !startProject.isHiddenFromMenu
      ? `/project/${startProject.id}/tasks`
      : todayUrl;
  }

  switch (defaultStartPage ?? DefaultStartPage.Today) {
    case DefaultStartPage.Inbox:
      // Legacy numeric value preserved for old configs.
      return `/project/${INBOX_PROJECT.id}/tasks`;
    case DefaultStartPage.Planner:
      return appFeatures.isPlannerEnabled ? '/planner' : todayUrl;
    case DefaultStartPage.Schedule:
      return appFeatures.isSchedulerEnabled ? '/schedule' : todayUrl;
    case DefaultStartPage.Boards:
      return appFeatures.isBoardsEnabled ? '/boards' : todayUrl;
    case DefaultStartPage.Today:
    default:
      return todayUrl;
  }
};
