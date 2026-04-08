import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MentionConfig, Mentions } from '../ui/mentions/mention-config';
import { MentionItem } from '../ui/mentions/mention-types';
import { GlobalConfigService } from '../features/config/global-config.service';
import { TagService } from '../features/tag/tag.service';
import { ProjectService } from '../features/project/project.service';
import { CHRONO_SUGGESTIONS } from '../features/tasks/add-task-bar/add-task-bar.const';

/**
 * Builds a shared MentionConfig observable used by both AddTaskBarComponent
 * and TaskTitleComponent to power short-syntax autocomplete (#tag, @due, +project).
 */
export const buildMentionConfig$ = (
  configService: GlobalConfigService,
  tagService: TagService,
  projectService: ProjectService,
): Observable<MentionConfig> => {
  return combineLatest([
    configService.shortSyntax$,
    tagService.tagsNoMyDayAndNoListSorted$,
    projectService.listSortedForUI$,
  ]).pipe(
    map(([cfg, tagSuggestions, projectSuggestions]) => {
      const mentions: Mentions[] = [];
      if (cfg.isEnableTag) {
        mentions.push({
          items: (tagSuggestions as unknown as MentionItem[]) || [],
          labelKey: 'title',
          triggerChar: '#',
        });
      }
      if (cfg.isEnableDue) {
        mentions.push({
          items: CHRONO_SUGGESTIONS,
          labelKey: 'title',
          triggerChar: '@',
        });
      }
      if (cfg.isEnableProject) {
        mentions.push({
          items: (projectSuggestions as unknown as MentionItem[]) || [],
          labelKey: 'title',
          triggerChar: '+',
        });
      }
      return {
        mentions,
        triggerChar: undefined,
      } as MentionConfig;
    }),
  );
};
