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
import { TagComponent } from '../tag/tag.component';
import { DEFAULT_PROJECT_COLOR } from '../../work-context/work-context.const';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';

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
}
