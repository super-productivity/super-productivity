import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { WorkViewComponent } from '../../features/work-view/work-view.component';
import { ProjectService } from '../../features/project/project.service';
import { PlainspaceClaimPoolService } from '../../features/plainspace/plainspace-claim-pool.service';
import {
  PLAINSPACE_PROJECT_ROWS,
  PlainspaceSharedTask,
} from '../../features/plainspace/plainspace-shared-task.model';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { T } from '../../t.const';
import { fastArrayCompare } from '../../util/fast-array-compare';

@Component({
  selector: 'work-view-page',
  templateUrl: './project-task-page.component.html',
  styleUrls: ['./project-task-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslatePipe, WorkViewComponent],
  providers: [
    {
      provide: PLAINSPACE_PROJECT_ROWS,
      useFactory: () => inject(ProjectTaskPageComponent),
    },
  ],
})
export class ProjectTaskPageComponent {
  workContextService = inject(WorkContextService);
  private readonly _projectService = inject(ProjectService);
  private readonly _plainspaceClaimPoolService = inject(PlainspaceClaimPoolService);

  readonly T = T;

  // The project entity re-emits on task changes. Fetch by project ID so local
  // edits don't reload the Plainspace overview.
  readonly teamOverview = toSignal(
    this._projectService.currentProject$.pipe(
      map((project) => project?.id ?? null),
      distinctUntilChanged(),
      switchMap((projectId) =>
        projectId
          ? this._plainspaceClaimPoolService.teamOverviewForProject$(projectId)
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  private readonly _providerId = computed(() => this.teamOverview()?.providerId);
  readonly onlyMine = linkedSignal({
    source: this._providerId,
    computation: () => false,
  });
  private readonly _ownedIds = computed(() => {
    const team = this.teamOverview();
    return new Set([
      ...(team?.assignedTaskIds ?? []),
      ...(team?.locallyAssignedTaskIds ?? []),
    ]);
  });
  private readonly _remoteIds = computed(
    () => new Set(this.teamOverview()?.tasks.map((t) => t.id)),
  );

  ownerLabel(issueId: string, providerId: string): string | undefined {
    if (this._providerId() !== providerId) return undefined;
    return this._ownedIds().has(issueId) ? T.PLAINSPACE.YOU : T.PLAINSPACE.LOCAL_COPY;
  }

  hideNativeTask(task: Task): boolean {
    if (
      !task.issueId ||
      !task.issueProviderId ||
      task.issueType !== 'PLAINSPACE' ||
      task.issueProviderId !== this._providerId() ||
      this._ownedIds().has(task.issueId)
    )
      return false;
    return this.onlyMine() || this._remoteIds().has(task.issueId);
  }

  isShowBacklog = toSignal(
    this.workContextService.activeWorkContext$.pipe(
      map((workContext) => !!workContext.isEnableBacklog),
    ),
    { initialValue: false },
  );

  private readonly _backlogTasks = toSignal(this.workContextService.backlogTasks$, {
    initialValue: [],
  });
  private readonly _doneTasks = toSignal(this.workContextService.doneTasks$, {
    initialValue: [],
  });
  private readonly _undoneTasks = toSignal(this.workContextService.undoneTasks$, {
    initialValue: [],
  });

  readonly taskLists = computed(() => {
    const backlog = this._backlogTasks();
    const done = this._doneTasks();
    const undone = this._undoneTasks();
    const localSubtaskParents: TaskWithSubTasks[] = [];
    const team = this.teamOverview();
    if (!team) return { backlog, done, undone, localSubtaskParents, previews: [] };

    const localTaskIdsByIssueId = new Map<string, string>();
    const recordLinkedTask = (task: Task): void => {
      if (
        task.issueType === 'PLAINSPACE' &&
        task.issueProviderId === team.providerId &&
        task.issueId
      ) {
        localTaskIdsByIssueId.set(task.issueId, task.id);
      }
    };
    const visibleTasks = (tasks: TaskWithSubTasks[]): TaskWithSubTasks[] => {
      const visible: TaskWithSubTasks[] = [];
      for (const task of tasks) {
        recordLinkedTask(task);
        task.subTasks.forEach(recordLinkedTask);
        if (!this.hideNativeTask(task)) {
          // Native task actions (including delete/undo) need the complete task tree.
          visible.push(task);
        } else {
          const children = task.subTasks.filter((child) => !this.hideNativeTask(child));
          if (children.length) localSubtaskParents.push({ ...task, subTasks: children });
        }
      }
      return fastArrayCompare(visible, tasks) ? tasks : visible;
    };

    const localLists = {
      backlog: visibleTasks(backlog),
      done: visibleTasks(done),
      undone: visibleTasks(undone),
    };
    const previews: PlainspaceSharedTask[] = [];
    for (const task of team.tasks) {
      const localTaskId = localTaskIdsByIssueId.get(task.id);
      if (this._ownedIds().has(task.id)) {
        if (!localTaskId) previews.push({ ...task, isMine: true });
      } else if (!this.onlyMine()) {
        previews.push(localTaskId ? { ...task, localTaskId } : task);
      }
    }
    return { ...localLists, localSubtaskParents, previews };
  });

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
