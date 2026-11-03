import { T } from '../../t.const';
import { INBOX_PROJECT } from '../project/project.const';
import { TODAY_TAG } from '../tag/tag.const';
import { WorkContextType } from '../work-context/work-context.model';

/**
 * Translation key for the one-line explanation shown when a list has never
 * held tasks. Today, the Inbox, projects and tags share this view, so a
 * single generic text would describe at least three of them wrongly.
 */
export const getEmptyStateHint = (ctx: { id: string; type: WorkContextType }): string => {
  if (ctx.id === TODAY_TAG.id) {
    return T.WW.EMPTY_HINT_TODAY;
  }
  if (ctx.id === INBOX_PROJECT.id) {
    return T.WW.EMPTY_HINT_INBOX;
  }
  return ctx.type === WorkContextType.PROJECT
    ? T.WW.EMPTY_HINT_PROJECT
    : T.WW.EMPTY_HINT_TAG;
};
