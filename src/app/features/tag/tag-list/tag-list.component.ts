import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { standardListAnimation } from '../../../ui/animations/standard-list.ani';
import { Tag, TagState } from '../tag.model';
import { ProjectState } from '../../project/project.model';
import { Task } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { expandFadeAnimation } from '../../../ui/animations/expand.ani';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectTagFeatureState } from '../store/tag.reducer';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { TagComponent, TagComponentTag } from '../tag/tag.component';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';
import {
  ISSUE_PROVIDER_ICON_MAP,
  ISSUE_PROVIDER_HUMANIZED,
} from '../../issue/issue.const';
import { BuiltInIssueProviderKey } from '../../issue/issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { selectTaskRepeatCfgFeatureState } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfgState } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getTaskRepeatInfoText } from '../../tasks/task-detail-panel/get-task-repeat-info-text.util';
import { TranslateService } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

@Component({
  selector: 'tag-list',
  templateUrl: './tag-list.component.html',
  styleUrls: ['./tag-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [standardListAnimation, expandFadeAnimation],
  imports: [TagComponent],
})
export class TagListComponent {
  private readonly _store = inject(Store);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _translateService = inject(TranslateService);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);

  task = input.required<Task>();

  tagsToHide = input<string[]>();

  isShowCurrentContextTag = input(false);
  isShowProjectTagAlways = input(false);
  isShowProjectTagNever = input(false);

  workContext = toSignal(this._workContextService.activeWorkContextTypeAndId$);

  tagState = toSignal(this._store.select(selectTagFeatureState), {
    initialValue: { ids: [], entities: {} } as TagState,
  });
  projectState = toSignal(this._store.select(selectProjectFeatureState), {
    initialValue: { ids: [], entities: {} } as ProjectState,
  });
  repeatCfgState = toSignal(this._store.select(selectTaskRepeatCfgFeatureState), {
    initialValue: { ids: [], entities: {} } as TaskRepeatCfgState,
  });

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
      return this.task().projectId;
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
        const pluginIcon = this._pluginRegistry.getIcon(t.issueType);
        icon = pluginIcon !== 'extension' ? pluginIcon : undefined;
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
        );
        chips.push({
          title: this._translateService.instant(key, params),
          svgIcon: 'repeat',
        });
      }
    }

    return chips;
  });
}
