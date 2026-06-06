import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { WorkViewComponent } from '../../features/work-view/work-view.component';
import { ProjectService } from '../../features/project/project.service';
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

  readonly T = T;

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
      this._projectService.unarchive(project.id);
    }
  }
}
