import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { Tag } from '../tag.model';
import { Task } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { expandFadeAnimation } from '../../../ui/animations/expand.ani';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TagComponent, TagComponentTag } from '../tag/tag.component';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';
import {
  ISSUE_PROVIDER_ICON_MAP,
  ISSUE_PROVIDER_HUMANIZED,
} from '../../issue/issue.const';
import { BuiltInIssueProviderKey } from '../../issue/issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { getTaskRepeatInfoText } from '../../tasks/task-detail-panel/get-task-repeat-info-text.util';
import { TranslateService } from '@ngx-translate/core';
import { TagListStateService } from './tag-list-state.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

/**
 * Structural contract of what tag-list actually reads from its input. Both
 * Task and TaskRepeatCfg satisfy it (repeat cfgs simply lack the optional
 * issue/repeat fields, so those chips never render for them).
 */
export type TagListTask = Pick<
  Task,
  'tagIds' | 'issueId' | 'issueType' | 'issuePoints' | 'repeatCfgId'
> & { projectId: string | null };

@Component({
  selector: 'tag-list',
  templateUrl: './tag-list.component.html',
  styleUrls: ['./tag-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation, expandFadeAnimation],
  imports: [TagComponent],
})
export class TagListComponent {
  private readonly _tagListState = inject(TagListStateService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _translateService = inject(TranslateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private readonly _router = inject(Router);

  task = input.required<TagListTask>();

  tagsToHide = input<string[]>();

  isShowCurrentContextTag = input(false);
  isShowProjectTagAlways = input(false);
  isShowProjectTagNever = input(false);
  // Off in modal dialogs, where navigating would change the page behind them.
  isProjectTagClickable = input(true);
  // From the host: importing TaskMultiSelectService or isMultiSelectModifierEvent
  // here splits each into its own lazy chunk (Lighthouse script budget).
  isTouchSelectionMode = input(false);

  workContext = toSignal(this._workContextService.activeWorkContextTypeAndId$);

  tagState = this._tagListState.tagState;
  projectState = this._tagListState.projectState;
  repeatCfgState = this._tagListState.repeatCfgState;

  tagIds = computed<string[]>(() => this.task().tagIds || []);

  tags = computed<Tag[]>(() => {
    const tagsToHide = this.tagsToHide();
    const tagIdsFiltered: string[] = !!tagsToHide
      ? tagsToHide.length > 0
        ? this.tagIds().filter((id) => !tagsToHide.includes(id))
        : this.tagIds()
      : this.tagIds().filter((id) => id !== this.workContext()?.activeId);

    // sort alphabetically by title
    const tagsI = tagIdsFiltered
      .map((id) => this.tagState()?.entities[id])
      .filter((tag): tag is Tag => !!tag)
      .sort((a, b) => a.title.localeCompare(b.title));

    const projectId = this.projectId();
    const project = projectId && this.projectState()?.entities[projectId];

    if (project && project.id) {
      const projectTag: Tag = {
        ...project,
        color: project.theme?.primary || DEFAULT_PROJECT_COLOR,
        created: 0,
        icon: project.icon || DEFAULT_PROJECT_ICON,
      };
      // project tag first then sorted tags
      return [projectTag, ...tagsI];
    }

    return tagsI;
  });

  projectId = computed<string | undefined>(() => {
    if (this.isShowProjectTagNever()) {
      return undefined;
    } else if (
      this.isShowProjectTagAlways() ||
      this.workContext()?.activeType === WorkContextType.TAG
    ) {
      return this.task().projectId ?? undefined;
    }
    return undefined;
  });

  indicatorChips = computed<TagComponentTag[]>(() => {
    // Read registration version to re-evaluate when plugins register
    this._pluginRegistry.registrationVersion();
    const t = this.task();
    const chips: TagComponentTag[] = [];

    if (t.issueId && t.issueType) {
      const builtInIcon = ISSUE_PROVIDER_ICON_MAP[t.issueType as BuiltInIssueProviderKey];
      const builtInLabel =
        ISSUE_PROVIDER_HUMANIZED[t.issueType as BuiltInIssueProviderKey];

      let icon: string | undefined;
      let label: string | undefined;

      if (builtInIcon && builtInLabel) {
        icon = builtInIcon;
        label = builtInLabel;
      } else if (this._pluginRegistry.hasProvider(t.issueType)) {
        icon = this._pluginRegistry.getSvgIcon(t.issueType);
        label = this._pluginRegistry.getHumanReadableName(t.issueType);
      }

      if (label) {
        chips.push({
          title: t.issuePoints ? `${label} (${t.issuePoints})` : label,
          svgIcon: icon,
        });
      }
    }

    if (t.repeatCfgId) {
      const repeatCfg = this.repeatCfgState()?.entities[t.repeatCfgId];
      if (repeatCfg) {
        const [key, params] = getTaskRepeatInfoText(
          repeatCfg,
          this._dateTimeFormatService.currentLocale(),
          this._dateTimeFormatService,
          this._translateService,
        );
        chips.push({
          title: this._translateService.instant(key, params),
          icon: 'repeat',
        });
      }
    }

    return chips;
  });

  openProject(ev: MouseEvent, projectId: string): void {
    // Modifier clicks and touch-selection taps stay with the row's multi-select.
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || this.isTouchSelectionMode()) {
      return;
    }
    // Keep the row's click handlers (select, detail panel) out of it (#9060).
    ev.stopPropagation();
    // The chip's mousedown kept focus where it was, so blur now: an open title
    // or estimate edit only saves on blur, which would arrive after teardown.
    (document.activeElement as HTMLElement | null)?.blur();
    void this._router.navigate([`/project/${projectId}/tasks`]);
  }
}
