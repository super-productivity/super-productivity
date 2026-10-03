import { inject, Injectable } from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { MentionConfig, Mentions } from '../../ui/mentions/mention-config';
import { GlobalConfigService } from '../config/global-config.service';
import { TagService } from '../tag/tag.service';
import { ProjectService } from '../project/project.service';
import {
  CHRONO_SUGGESTIONS,
  REPEAT_SUGGESTIONS,
} from './add-task-bar/add-task-bar.const';
import { DEFAULT_PROJECT_ICON } from '../project/project.const';
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
} from '../work-context/work-context.const';
import { isSingleEmoji } from '../../util/extract-first-emoji';
import { MentionItem } from '../../ui/mentions/mention-types';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';

interface MentionListItem extends MentionItem {
  title: string;
  id?: string;
  icon?: string;
  color?: string;
  isEmoji?: boolean;
}

const toChronoItems = (titles: string[]): MentionListItem[] =>
  titles.map((title) => ({ title, icon: 'schedule' }));

const buildMentionConfig = (
  cfg: ShortSyntaxConfig,
  tagSuggestions: Tag[],
  projectSuggestions: Project[],
  isWithRepeat: boolean,
): MentionConfig => {
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
    mentions.push({
      items: toChronoItems(
        isWithRepeat
          ? [...CHRONO_SUGGESTIONS, ...REPEAT_SUGGESTIONS]
          : CHRONO_SUGGESTIONS,
      ),
      labelKey: 'title',
      triggerChar: '@',
    });
  }
  if (cfg.isEnableDeadline) {
    mentions.push({
      items: toChronoItems(CHRONO_SUGGESTIONS),
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
};

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

  private readonly _sources$ = combineLatest([
    this._globalConfigService.shortSyntax$,
    this._tagService.tagsNoMyDayAndNoListSorted$,
    this._projectService.listSortedForUI$,
  ]);

  // Title edits of existing tasks: recurrence phrases are parsed as plain
  // dates there, so they are not offered.
  readonly mentionConfig$: Observable<MentionConfig> = this._sources$.pipe(
    map(([cfg, tags, projects]) => buildMentionConfig(cfg, tags, projects, false)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // Task creation: the due-date trigger also offers recurrence phrases.
  readonly addTaskBarMentionConfig$: Observable<MentionConfig> = this._sources$.pipe(
    map(([cfg, tags, projects]) => buildMentionConfig(cfg, tags, projects, true)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}
