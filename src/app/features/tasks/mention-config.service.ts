import { inject, Injectable } from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { MentionConfig, Mentions } from '../../ui/mentions/mention-config';
import { MentionItem } from '../../ui/mentions/mention-types';
import { GlobalConfigService } from '../config/global-config.service';
import { TagService } from '../tag/tag.service';
import { ProjectService } from '../project/project.service';
import { CHRONO_SUGGESTIONS } from './add-task-bar/add-task-bar.const';

/**
 * Single source of truth for the task short-syntax (#tag, @due, +project)
 * autocomplete config. Used by AddTaskBarComponent and TaskTitleComponent.
 *
 * Exposed as a root-provided service (not a factory) so the sort/filter
 * pipeline runs once, shared across every editor instance.
 */
@Injectable({ providedIn: 'root' })
export class MentionConfigService {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _tagService = inject(TagService);
  private readonly _projectService = inject(ProjectService);

  readonly mentionConfig$: Observable<MentionConfig> = combineLatest([
    this._globalConfigService.shortSyntax$,
    this._tagService.tagsNoMyDayAndNoListSorted$,
    this._projectService.listSortedForUI$,
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
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}
