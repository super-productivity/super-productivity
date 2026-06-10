import { TODAY_TAG } from '../../features/tag/tag.const';
import { WorkContext } from '../../features/work-context/work-context.model';
import { ActiveWorkContext } from '../plugin-api.model';

/**
 * Project a host `WorkContext` into the plugin-facing `ActiveWorkContext`
 * snapshot used by `getActiveWorkContext()` and the `WORK_CONTEXT_CHANGE` hook.
 *
 * Single source of truth for that projection so the pull API and the push
 * hook can never disagree. `taskIds` is copied so a plugin cannot mutate
 * NgRx state through the snapshot, and the special Today tag is reported with
 * type `'TODAY'` (it is otherwise an ordinary tag).
 */
export const toActiveWorkContext = (ctx: WorkContext): ActiveWorkContext => ({
  id: ctx.id,
  type: ctx.id === TODAY_TAG.id ? 'TODAY' : ctx.type,
  title: ctx.title,
  taskIds: [...ctx.taskIds],
});
