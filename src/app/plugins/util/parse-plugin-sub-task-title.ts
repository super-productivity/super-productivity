import { TaskCopy } from '../../features/tasks/task.model';
import { parseTimeSpentChanges } from '../../features/tasks/short-syntax';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { ShortSyntaxConfig } from '../../features/config/global-config.model';

/**
 * Mirrors MarkdownPasteService._parseTimeProps: respects the user's
 * shortSyntax.isEnableDue config, returns the cleaned title and any parsed
 * time fields. Used for subtasks created via the plugin API, which opt out of
 * the ShortSyntaxEffects pipeline (isIgnoreShortSyntax) to parse time only and
 * keep tags/project inherited from the parent. A plugin that asks to keep the
 * title verbatim skips the time parsing too.
 */
export const parsePluginSubTaskTitle = (
  originalTitle: string,
  shortSyntaxCfg: ShortSyntaxConfig | undefined,
  isIgnoreShortSyntax: boolean,
): { title: string; timeProps: Partial<TaskCopy> } => {
  const cfg = shortSyntaxCfg ?? DEFAULT_GLOBAL_CONFIG.shortSyntax;
  if (isIgnoreShortSyntax || !cfg.isEnableDue) {
    return { title: originalTitle, timeProps: {} };
  }
  const { title: cleanedTitle, ...timeProps } = parseTimeSpentChanges({
    title: originalTitle,
  });
  return { title: cleanedTitle ?? originalTitle, timeProps };
};
