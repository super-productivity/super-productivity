import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { WorkViewComponent } from '../../features/work-view/work-view.component';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { WorkViewLayoutService } from '../../features/work-view/work-view-layout.service';

@Component({
  selector: 'tag-task-page',
  templateUrl: './tag-task-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkViewComponent],
})
export class TagTaskPageComponent {
  private _workContextService = inject(WorkContextService);
  private _workViewLayout = inject(WorkViewLayoutService);

  backlogTasks = toSignal(this._workContextService.backlogTasks$, { initialValue: [] });
  doneTasks = toSignal(this._workContextService.doneTasks$, { initialValue: [] });
  undoneTasks = toSignal(this._workContextService.undoneTasks$, { initialValue: [] });
  isTodayBoard = computed(
    () => this._workViewLayout.getLayout(TODAY_TAG.id) === 'kanban',
  );
}
