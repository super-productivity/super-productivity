import { computed, inject, Injectable } from '@angular/core';
import { combineLatest, firstValueFrom, Observable, of } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
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
  completeProject,
  moveProjectTaskToBacklogList,
  moveProjectTaskToBacklogListAuto,
  moveProjectTaskToRegularListAuto,
  reopenProject,
  toggleHideFromMenu,
  unarchiveProject,
  updateProject,
  updateProjectOrder,
} from './store/project.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DEFAULT_PROJECT, INBOX_PROJECT } from './project.const';
import {
  selectArchivedProjects,
  selectProjectById,
  selectUnarchivedProjects,
  selectUnarchivedProjectsWithoutCurrent,
} from './store/project.selectors';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { getTaskById } from '../tasks/store/task.reducer.util';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { T } from 'src/app/t.const';
import { sortByTitle } from '../../util/sort-by-title';
import { Note } from '../note/note.model';
import { selectNoteFeatureState } from '../note/store/note.reducer';
import { addNote } from '../note/store/note.actions';
import { Section } from '../section/section.model';
import { addSection } from '../section/store/section.actions';
import { selectSectionsByContextIdMap } from '../section/store/section.selectors';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { DateService } from '../../core/date/date.service';
import { getDeadlineAutoPlanFields } from '../tasks/util/get-deadline-auto-plan-fields';
import { MenuTreeService } from '../menu-tree/menu-tree.service';
import { selectMenuTreeProjectTree } from '../menu-tree/store/menu-tree.selectors';
import { TaskTimeSyncService } from '../tasks/task-time-sync.service';

export interface ProjectCompletionInfo {
  topLevelTasks: Task[];
  allTasks: Task[];
  unfinishedTasks: Task[];
  topLevelTasksWithUnfinishedWork: Task[];
}

/**
 * Depth-first flatten of a task tree into a flat list (each parent immediately
 * before its subtasks), de-duplicated via a shared `seen` set so a task reached
 * from more than one parent is included only once.
 */
const flattenTaskTree = (
  topLevelTasks: Task[],
  entities: Record<string, Task | undefined>,
): Task[] => {
  const result: Task[] = [];
  const seen = new Set<string>();
  const visit = (task: Task): void => {
    if (seen.has(task.id)) {
      return;
    }
    seen.add(task.id);
    result.push(task);
    (task.subTaskIds ?? []).forEach((subId) => {
      const sub = entities[subId];
      if (sub) {
        visit(sub);
      }
    });
  };
  topLevelTasks.forEach(visit);
  return result;
};

/** True if the task itself or any of its (live) subtasks is still unfinished. */
const hasUnfinishedWork = (
  task: Task,
  unfinishedTaskIds: Set<string>,
  entities: Record<string, Task | undefined>,
): boolean =>
  unfinishedTaskIds.has(task.id) ||
  (task.subTaskIds ?? []).some((subId) => {
    const sub = entities[subId];
    return !!sub && hasUnfinishedWork(sub, unfinishedTaskIds, entities);
  });

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly _workContextService = inject(WorkContextService);
  private readonly _store$ = inject<Store<any>>(Store);
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _timeTrackingService = inject(TimeTrackingService);
  private readonly _taskService = inject(TaskService);
  private readonly _taskTimeSync = inject(TaskTimeSyncService);
  private readonly _translate = inject(TranslateService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _dateService = inject(DateService);
  private readonly _snackService = inject(SnackService);
  private readonly _menuTreeService = inject(MenuTreeService);

  list$: Observable<Project[]> = this._store$.pipe(select(selectUnarchivedProjects));
  list = toSignal(this.list$, { initialValue: [] });

  private _listInTreeOrder = computed(() =>
    this._menuTreeService.buildProjectListInTreeOrder(this.list()),
  );
  listInTreeOrder$ = toObservable(this._listInTreeOrder);

  listSorted$: Observable<Project[]> = this.list$.pipe(
    map((projects) => sortByTitle(projects)),
  );
  listSorted = toSignal(this.listSorted$, { initialValue: [] });

  // Filtered and sorted list for UI (excludes archived and hidden projects)
  listSortedForUI$: Observable<Project[]> = this.listSorted$.pipe(
    map((projects) => projects.filter((p) => !p.isArchived && !p.isHiddenFromMenu)),
  );
  listSortedForUI = toSignal(this.listSortedForUI$, { initialValue: [] });

  listInTreeOrderForUI = computed(() =>
    this._listInTreeOrder().filter((p) => !p.isArchived && !p.isHiddenFromMenu),
  );

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

  getProjectsWithoutIdInTreeOrder$(projectId: string | null): Observable<Project[]> {
    return combineLatest([
      this.getProjectsWithoutId$(projectId),
      this._store$.pipe(select(selectMenuTreeProjectTree)),
    ]).pipe(
      map(([projects]) => this._menuTreeService.buildProjectListInTreeOrder(projects)),
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

  async unarchive(projectId: string): Promise<void> {
    const project = await firstValueFrom(this.getByIdOnce$(projectId));
    this._store$.dispatch(unarchiveProject({ id: projectId }));
    this._snackService.open(
      project?.isHiddenFromMenu
        ? {
            ico: 'unarchive',
            msg: T.F.PROJECT.S.UNARCHIVED_HIDDEN_FROM_MENU,
            actionStr: T.F.PROJECT.S.SHOW_IN_MENU,
            actionFn: () => this._store$.dispatch(toggleHideFromMenu({ id: projectId })),
          }
        : {
            ico: 'unarchive',
            msg: T.F.PROJECT.S.UNARCHIVED,
          },
    );
  }

  complete(projectId: string, doneOn: number): void {
    // Single-entity flag flip. Unfinished-task resolution (move-to-inbox /
    // mark-done) is dispatched separately as normal per-task actions before
    // this call — see moveTasksToInbox / markTasksDone and the completion flow
    // in work-context-menu. No undo affordance: that resolution can't be fully
    // restored by reopen, so the fullscreen celebration is the feedback and
    // reactivation lives on the archived-projects page.
    this._store$.dispatch(completeProject({ id: projectId, doneOn }));
  }

  /**
   * Carry unfinished work forward into the Inbox before completing a project.
   * Uses the normal per-task move action so every downstream effect (issue
   * sync, reminders, repeat-cfg) and per-entity conflict detection fires
   * naturally. Done tasks are explicitly re-opened (setUnDone) so carried-over
   * work is actionable again in the Inbox — the move itself keeps isDone.
   * The trailing flush is the bulk-dispatch guard (sync-model Rule #6).
   */
  async moveTasksToInbox(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      const withSubTasks = await firstValueFrom(
        this._taskService.getByIdWithSubTaskData$(task.id),
      );
      this._taskService.moveToProject(withSubTasks, INBOX_PROJECT.id);
      if (task.isDone) {
        this._taskService.setUnDone(task.id);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Mark a project's unfinished tasks done via the normal per-task action. */
  async markTasksDone(tasks: Task[]): Promise<void> {
    tasks.forEach((task) => this._taskService.setDone(task.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  reopen(projectId: string, project?: Pick<Project, 'isHiddenFromMenu'>): void {
    this._store$.dispatch(reopenProject({ id: projectId }));
    this._snackService.open(
      project?.isHiddenFromMenu
        ? {
            ico: 'replay',
            msg: T.F.PROJECT.S.REOPENED,
            actionStr: T.F.PROJECT.S.SHOW_IN_MENU,
            actionFn: () => this._store$.dispatch(toggleHideFromMenu({ id: projectId })),
          }
        : {
            ico: 'replay',
            msg: T.F.PROJECT.S.REOPENED,
          },
    );
  }

  /**
   * Tasks of a project for the completion flow. Stats include live and archived
   * project tasks, while unfinished resolution only considers active tasks that
   * can still be moved or marked done from the live store.
   */
  async getCompletionInfo(projectId: string): Promise<ProjectCompletionInfo> {
    const project = await firstValueFrom(this.getByIdOnce$(projectId));
    if (!project) {
      return {
        topLevelTasks: [],
        allTasks: [],
        unfinishedTasks: [],
        topLevelTasksWithUnfinishedWork: [],
      };
    }
    const stats = await this._getCompletionStatsTasks(projectId, project);
    const resolvable = await this._getResolvableTasks(project);
    return { ...stats, ...resolvable };
  }

  /**
   * Stats lists for the celebration: count live AND archived project tasks, so
   * work the user archived earlier still counts toward the finished total.
   */
  private async _getCompletionStatsTasks(
    projectId: string,
    project: Project,
  ): Promise<Pick<ProjectCompletionInfo, 'topLevelTasks' | 'allTasks'>> {
    const ids = [...(project.taskIds ?? []), ...(project.backlogTaskIds ?? [])];
    const idSet = new Set(ids);
    const projectTasks = await this._taskService.getAllTasksForProject(projectId);
    const projectTaskById = new Map(projectTasks.map((task) => [task.id, task]));
    const topLevelTasks = [
      ...ids,
      ...projectTasks
        .filter((task) => !task.parentId && !idSet.has(task.id))
        .map((task) => task.id),
    ]
      .map((id) => projectTaskById.get(id))
      .filter((t): t is Task => !!t);
    const allTasks = flattenTaskTree(topLevelTasks, Object.fromEntries(projectTaskById));
    return { topLevelTasks, allTasks };
  }

  /**
   * Resolvable lists for the unfinished-task prompt: only LIVE tasks can still
   * be moved or marked done, so the archive is intentionally ignored here.
   */
  private async _getResolvableTasks(
    project: Project,
  ): Promise<
    Pick<ProjectCompletionInfo, 'unfinishedTasks' | 'topLevelTasksWithUnfinishedWork'>
  > {
    const taskState = await firstValueFrom(this._store$.select(selectTaskFeatureState));
    const ids = [...(project.taskIds ?? []), ...(project.backlogTaskIds ?? [])];
    const activeTopLevelTasks = ids
      .map((id) => taskState.entities[id])
      .filter((t): t is Task => !!t);
    const activeAllTasks = flattenTaskTree(activeTopLevelTasks, taskState.entities);
    const unfinishedTasks = activeAllTasks.filter((t) => !t.isDone);
    const unfinishedTaskIds = new Set(unfinishedTasks.map((t) => t.id));
    return {
      unfinishedTasks,
      topLevelTasksWithUnfinishedWork: activeTopLevelTasks.filter((t) =>
        hasUnfinishedWork(t, unfinishedTaskIds, taskState.entities),
      ),
    };
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
    allTaskIds.forEach((taskId) => this._taskTimeSync.clearOne(taskId));
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
      // A duplicate is a fresh, active project — never inherit completed/archived state.
      isDone: false,
      doneOn: null,
      isArchived: false,
    });

    const noteState = await firstValueFrom(this._store$.select(selectNoteFeatureState));
    const notesToCopy = template.noteIds
      .map((noteId) => noteState.entities[noteId])
      .filter((note): note is Note => !!note);
    const newNoteIds = this._duplicateNotesToProject(notesToCopy, newProjectId);
    this.update(newProjectId, { noteIds: newNoteIds });

    const sectionsMap = await firstValueFrom(
      this._store$.select(selectSectionsByContextIdMap),
    );
    const sectionsToCopy = sectionsMap.get(templateProjectId) ?? [];

    const taskIdMap = new Map<string, string>();
    this._duplicateTasksToProject(parentTasks, newProjectId, false, taskState, taskIdMap);
    this._duplicateTasksToProject(backlogTasks, newProjectId, true, taskState, taskIdMap);

    this._duplicateSectionsToProject(sectionsToCopy, newProjectId, taskIdMap);

    return newProjectId;
  }

  private _duplicateTasksToProject(
    tasks: Task[],
    newProjectId: string,
    isBacklog: boolean,
    taskState: TaskState,
    taskIdMap: Map<string, string>,
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
      taskIdMap.set(p.id, newParentTask.id);

      // dispatch addTask for the parent task
      this._store$.dispatch(
        TaskSharedActions.addTask({
          task: newParentTask,
          workContextId: newProjectId,
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: isBacklog,
          isAddToBottom: true,
          ...getDeadlineAutoPlanFields(
            this._dateService,
            newParentTask.deadlineDay,
            newParentTask.deadlineWithTime,
          ),
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
          taskIdMap.set(st.id, newSub.id);

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

  private _duplicateSectionsToProject(
    sections: Section[],
    newProjectId: string,
    taskIdMap: Map<string, string>,
  ): void {
    for (const section of sections) {
      const newTaskIds = section.taskIds
        .map((id) => taskIdMap.get(id))
        .filter((id): id is string => !!id);

      this._store$.dispatch(
        addSection({
          section: {
            id: nanoid(),
            contextId: newProjectId,
            contextType: WorkContextType.PROJECT,
            title: section.title,
            isExpanded: section.isExpanded,
            taskIds: newTaskIds,
          },
        }),
      );
    }
  }
}
