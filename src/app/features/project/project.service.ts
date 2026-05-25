import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { Project } from './project.model';
import { select, Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import { ofType } from '@ngrx/effects';
import { map, shareReplay, switchMap, take } from 'rxjs/operators';
import {
  BreakNr,
  BreakNrCopy,
  BreakTime,
  BreakTimeCopy,
  WorkContextType,
} from '../work-context/work-context.model';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../tasks/task.service';
import { addSubTask } from '../tasks/store/task.actions';
import { Task, TaskState } from '../tasks/task.model';
import { WorkContextService } from '../work-context/work-context.service';
import {
  addProject,
  archiveProject,
  moveProjectTaskToBacklogList,
  moveProjectTaskToBacklogListAuto,
  moveProjectTaskToRegularListAuto,
  unarchiveProject,
  updateProject,
  updateProjectOrder,
} from './store/project.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DEFAULT_PROJECT } from './project.const';
import {
  selectArchivedProjects,
  selectProjectById,
  selectUnarchivedProjects,
  selectUnarchivedProjectsWithoutCurrent,
} from './store/project.selectors';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { getTaskById } from '../tasks/store/task.reducer.util';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { sortByTitle } from '../../util/sort-by-title';
import { Note } from '../note/note.model';
import { selectNoteFeatureState } from '../note/store/note.reducer';
import { addNote } from '../note/store/note.actions';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly _workContextService = inject(WorkContextService);
  private readonly _store$ = inject<Store<any>>(Store);
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _timeTrackingService = inject(TimeTrackingService);
  private readonly _taskService = inject(TaskService);
  private readonly _translate = inject(TranslateService);
  private readonly _matDialog = inject(MatDialog);

  list$: Observable<Project[]> = this._store$.pipe(select(selectUnarchivedProjects));
  list = toSignal(this.list$, { initialValue: [] });

  listSorted$: Observable<Project[]> = this.list$.pipe(
    map((projects) => sortByTitle(projects)),
  );
  listSorted = toSignal(this.listSorted$, { initialValue: [] });

  // Filtered and sorted list for UI (excludes archived and hidden projects)
  listSortedForUI$: Observable<Project[]> = this.listSorted$.pipe(
    map((projects) => projects.filter((p) => !p.isArchived && !p.isHiddenFromMenu)),
  );
  listSortedForUI = toSignal(this.listSortedForUI$, { initialValue: [] });

  archived$: Observable<Project[]> = this._store$.pipe(select(selectArchivedProjects));

  currentProject$: Observable<Project | null | undefined> =
    this._workContextService.activeWorkContextTypeAndId$.pipe(
      switchMap(({ activeId, activeType }) =>
        activeType === WorkContextType.PROJECT ? this.getByIdLive$(activeId) : of(null),
      ),
      shareReplay(1),
    );

  onMoveToBacklog$: Observable<any> = this._actions$.pipe(
    ofType(moveProjectTaskToBacklogList),
  );

  getProjectsWithoutId$(projectId: string | null): Observable<Project[]> {
    return this._store$.pipe(
      select(selectUnarchivedProjectsWithoutCurrent, { currentId: projectId }),
    );
  }

  getProjectsWithoutIdSorted$(projectId: string | null): Observable<Project[]> {
    return this.getProjectsWithoutId$(projectId).pipe(
      map((projects) => sortByTitle(projects)),
    );
  }

  getBreakNrForProject$(projectId: string): Observable<BreakNr> {
    return this._timeTrackingService.state$.pipe(
      map((current) => {
        const dataForProject = current.project[projectId];
        const breakNr: BreakNrCopy = {};
        if (dataForProject) {
          Object.keys(dataForProject).forEach((dateStr) => {
            const dateData = dataForProject[dateStr];
            if (typeof dateData?.b === 'number') {
              breakNr[dateStr] = dateData.b;
            }
          });
        }
        return breakNr;
      }),
    );
  }

  getBreakTimeForProject$(projectId: string): Observable<BreakTime> {
    return this._timeTrackingService.state$.pipe(
      map((current) => {
        const dataForProject = current.project[projectId];
        const breakTime: BreakTimeCopy = {};
        if (dataForProject) {
          Object.keys(dataForProject).forEach((dateStr) => {
            const dateData = dataForProject[dateStr];
            if (typeof dateData?.bt === 'number') {
              breakTime[dateStr] = dateData.bt;
            }
          });
        }
        return breakTime;
      }),
    );
  }

  archive(projectId: string): void {
    this._store$.dispatch(archiveProject({ id: projectId }));
  }

  unarchive(projectId: string): void {
    this._store$.dispatch(unarchiveProject({ id: projectId }));
  }

  getByIdOnce$(id: string): Observable<Project | undefined> {
    if (!id) {
      throw new Error('No id given');
    }
    return this._store$.pipe(select(selectProjectById, { id }), take(1));
  }

  getByIdOnceCatchError$(id: string): Observable<Project | undefined> {
    if (!id) {
      throw new Error('No id given');
    }
    return this._store$.pipe(select(selectProjectById, { id }), take(1));
  }

  getByIdLive$(id: string): Observable<Project | undefined> {
    if (!id) {
      throw new Error('No id given');
    }
    return this._store$.pipe(select(selectProjectById, { id }));
  }

  add(project: Partial<Project>): string {
    const id = nanoid();
    this._store$.dispatch(
      addProject({
        project: {
          ...DEFAULT_PROJECT,
          ...project,
          id,
        },
      }),
    );
    return id;
  }

  async remove(project: Project): Promise<void> {
    const taskState = await this._store$
      .select(selectTaskFeatureState)
      .pipe(take(1))
      .toPromise();
    const subTaskIdsForProject: string[] = [];
    const allParentTaskIds = [...project.taskIds, ...project.backlogTaskIds];
    allParentTaskIds.forEach((id) => {
      const task = getTaskById(id, taskState);
      if (task.projectId && task.subTaskIds.length > 0) {
        subTaskIdsForProject.push(...task.subTaskIds);
      }
    });
    const allTaskIds = [...allParentTaskIds, ...subTaskIdsForProject];
    this._store$.dispatch(
      TaskSharedActions.deleteProject({
        projectId: project.id,
        noteIds: project.noteIds,
        allTaskIds,
      }),
    );
  }

  update(projectId: string, changedFields: Partial<Project>): void {
    this._store$.dispatch(
      updateProject({
        project: {
          id: projectId,
          changes: changedFields,
        },
      }),
    );
  }

  moveTaskToTodayList(id: string, projectId: string, isMoveToTop: boolean = false): void {
    this._store$.dispatch(
      moveProjectTaskToRegularListAuto({
        taskId: id,
        isMoveToTop,
        projectId,
      }),
    );
  }

  moveTaskToBacklog(taskId: string, projectId: string): void {
    this._store$.dispatch(moveProjectTaskToBacklogListAuto({ taskId, projectId }));
  }

  updateOrder(ids: string[]): void {
    this._store$.dispatch(updateProjectOrder({ ids }));
  }

  async duplicateProject(templateProjectId: string): Promise<string> {
    if (!templateProjectId) {
      throw new Error('No template project id given');
    }

    const template = await firstValueFrom(this.getByIdOnce$(templateProjectId));
    if (!template) {
      throw new Error('Template project not found');
    }

    const taskState = await firstValueFrom(this._store$.select(selectTaskFeatureState));
    const parentTasks = template.taskIds
      .map((id) => taskState.entities[id])
      .filter((t): t is Task => !!t);
    const backlogTasks = template.backlogTaskIds
      .map((id) => taskState.entities[id])
      .filter((t): t is Task => !!t);

    let totalTaskCount = parentTasks.length + backlogTasks.length;
    parentTasks.forEach((p) => (totalTaskCount += p.subTaskIds.length));
    backlogTasks.forEach((p) => (totalTaskCount += p.subTaskIds.length));

    if (totalTaskCount > 50) {
      const isConfirmed = await firstValueFrom(
        this._matDialog
          .open(DialogConfirmComponent, {
            restoreFocus: true,
            data: {
              title: this._translate.instant(
                T.F.PROJECT.D_CONFIRM_DUPLICATE_BIG_PROJECT.TITLE,
              ),
              message: this._translate.instant(
                T.F.PROJECT.D_CONFIRM_DUPLICATE_BIG_PROJECT.MSG,
                {
                  taskCount: totalTaskCount,
                },
              ),
              okTxt: T.F.PROJECT.D_CONFIRM_DUPLICATE_BIG_PROJECT.OK,
              cancelTxt: T.F.PROJECT.D_CONFIRM_DUPLICATE_BIG_PROJECT.CANCEL,
            },
          })
          .afterClosed(),
      );

      if (!isConfirmed) {
        return Promise.reject('User cancelled duplication of large project');
      }
    }

    // Create new project with copied basic cfg but empty task lists (tasks are duplicated separately)
    const newProjectId = this.add({
      ...template,
      title: `${template.title}${this._translate.instant(T.GLOBAL.COPY_SUFFIX)}`,
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
    });

    const noteState = await firstValueFrom(this._store$.select(selectNoteFeatureState));
    const notesToCopy = template.noteIds
      .map((noteId) => noteState.entities[noteId])
      .filter((note): note is Note => !!note);
    const newNoteIds = this._duplicateNotesToProject(notesToCopy, newProjectId);
    this.update(newProjectId, { noteIds: newNoteIds });

    this._duplicateTasksToProject(parentTasks, newProjectId, false, taskState);

    this._duplicateTasksToProject(backlogTasks, newProjectId, true, taskState);

    return newProjectId;
  }

  private _duplicateTasksToProject(
    tasks: Task[],
    newProjectId: string,
    isBacklog: boolean,
    taskState: TaskState,
  ): void {
    // For each parent task create a copy in the new project and then copy its subtasks
    for (const p of tasks) {
      const subTasks = p.subTaskIds
        .map((id) => taskState.entities[id])
        .filter((t): t is Task => t !== undefined && t !== null);

      // copy and remove meta fields we don't want to pass as "additional"
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {
        id,
        parentId,
        subTaskIds,
        projectId,
        created,
        timeSpent,
        timeSpentOnDay,
        ...taskDataToCopy
      } = p;
      /* eslint-enable @typescript-eslint/no-unused-vars */

      const newParentTask = this._taskService.createNewTaskWithDefaults({
        title: p.title,
        additional: taskDataToCopy,
        workContextType: WorkContextType.PROJECT,
        workContextId: newProjectId,
      });

      // dispatch addTask for the parent task
      this._store$.dispatch(
        TaskSharedActions.addTask({
          task: newParentTask,
          workContextId: newProjectId,
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: isBacklog,
          isAddToBottom: true,
        }),
      );

      // create subtasks
      if (subTasks && subTasks.length > 0) {
        for (const st of subTasks) {
          /* eslint-disable @typescript-eslint/no-unused-vars */
          const {
            id: _id,
            parentId: _parentId,
            subTaskIds: _subTaskIds,
            projectId: _projectId,
            created: _created,
            timeSpent: _timeSpent,
            timeSpentOnDay: _timeSpentOnDay,
            ...subTaskDataToCopy
          } = st;
          /* eslint-enable @typescript-eslint/no-unused-vars */

          const newSub = this._taskService.createNewTaskWithDefaults({
            title: st.title,
            additional: subTaskDataToCopy,
            workContextType: WorkContextType.PROJECT,
            workContextId: newProjectId,
          });

          this._store$.dispatch(addSubTask({ task: newSub, parentId: newParentTask.id }));
        }
      }
    }
  }

  private _duplicateNotesToProject(notes: Note[], newProjectId: string): string[] {
    const newNoteIds: string[] = [];
    for (const note of notes) {
      const newNoteId = nanoid();
      newNoteIds.push(newNoteId);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, projectId, isPinnedToToday, created, modified, ...noteToCopy } = note;

      const newNote: Note = {
        ...noteToCopy,
        id: newNoteId,
        projectId: newProjectId,
        isPinnedToToday: false,
        created: Date.now(),
        modified: Date.now(),
      };
      this._store$.dispatch(addNote({ note: newNote, isPreventFocus: true }));
    }
    return newNoteIds;
  }
}
