import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { WorkViewComponent } from '../../features/work-view/work-view.component';
import { ProjectService } from '../../features/project/project.service';
import { PlainspaceSharedTasksService } from '../../features/plainspace/plainspace-shared-tasks.service';
import { PlainspaceSharedTask } from '../../features/plainspace/plainspace-shared-task.model';
import { T } from '../../t.const';

@Component({
  selector: 'work-view-page',
  templateUrl: './project-task-page.component.html',
  styleUrls: ['./project-task-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslatePipe, WorkViewComponent],
})
export class ProjectTaskPageComponent {
  workContextService = inject(WorkContextService);
  private readonly _projectService = inject(ProjectService);
  private readonly _plainspaceSharedTasksService = inject(PlainspaceSharedTasksService);

  readonly T = T;

  // Read-only Plainspace tasks assigned to other members (only for projects
  // shared on Plainspace); fed into the work view's "Assigned to others" panel.
  readonly assignedToOthersTasks = toSignal(
    this._projectService.currentProject$.pipe(
      switchMap((project) =>
        project
          ? this._plainspaceSharedTasksService.othersTasksForProject$(project.id)
          : of([] as PlainspaceSharedTask[]),
      ),
    ),
    { initialValue: [] as PlainspaceSharedTask[] },
  );

  isShowBacklog = toSignal(
    this.workContextService.activeWorkContext$.pipe(
      map((workContext) => !!workContext.isEnableBacklog),
    ),
    { initialValue: false },
  );

  backlogTasks = toSignal(this.workContextService.backlogTasks$, { initialValue: [] });
  doneTasks = toSignal(this.workContextService.doneTasks$, { initialValue: [] });
  undoneTasks = toSignal(this.workContextService.undoneTasks$, { initialValue: [] });

  readonly currentProject = toSignal(this._projectService.currentProject$, {
    initialValue: null,
  });

  restoreProject(): void {
    const project = this.currentProject();
    if (project) {
      if (project.isDone) {
        this._projectService.reopen(project.id, project);
      } else {
        this._projectService.unarchive(project.id);
      }
    }
  }
}
