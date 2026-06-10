import { inject, Injectable } from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { MentionConfig, Mentions } from '../../ui/mentions/mention-config';
import { GlobalConfigService } from '../config/global-config.service';
import { TagService } from '../tag/tag.service';
import { ProjectService } from '../project/project.service';
import { CHRONO_SUGGESTIONS } from './add-task-bar/add-task-bar.const';
import { DEFAULT_PROJECT_ICON } from '../project/project.const';
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
} from '../work-context/work-context.const';
import { isSingleEmoji } from '../../util/extract-first-emoji';
import { MentionItem } from '../../ui/mentions/mention-types';

interface MentionListItem extends MentionItem {
  title: string;
  id?: string;
  icon?: string;
  color?: string;
  isEmoji?: boolean;
}

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
          items: tagSuggestions.map(
            (tag): MentionListItem => ({
              title: tag.title,
              id: tag.id,
              icon: tag.icon || 'label',
              color: tag.color || tag.theme?.primary || DEFAULT_TAG_COLOR,
              isEmoji: !!tag.icon && isSingleEmoji(tag.icon),
            }),
          ),
          labelKey: 'title',
          triggerChar: '#',
        });
      }
      if (cfg.isEnableDue) {
        const chronoItems = CHRONO_SUGGESTIONS.map(
          (title): MentionListItem => ({
            title,
            icon: 'schedule',
          }),
        );
        mentions.push({
          items: chronoItems,
          labelKey: 'title',
          triggerChar: '@',
        });
        mentions.push({
          items: chronoItems,
          labelKey: 'title',
          triggerChar: '!',
        });
      }
      if (cfg.isEnableProject) {
        mentions.push({
          items: projectSuggestions.map(
            (project): MentionListItem => ({
              title: project.title,
              id: project.id,
              icon: project.icon || DEFAULT_PROJECT_ICON,
              color: project.theme?.primary || DEFAULT_PROJECT_COLOR,
              isEmoji: !!project.icon && isSingleEmoji(project.icon),
            }),
          ),
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
