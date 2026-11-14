import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from './task.service';
import { TaskWithSubTasks } from './task.model';
import { addSubTask } from './store/task.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { isWontDoTask } from './util/is-wont-do-task';
import { selectActiveWorkContext } from '../work-context/store/work-context.selectors';
import { selectSectionsByContextIdMap } from '../section/store/section.selectors';
import { selectPlannerState } from '../planner/store/planner.selectors';
import { addTaskToSection } from '../section/store/section.actions';
import { moveProjectTaskToBacklogList } from '../project/store/project.actions';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { updateTag } from '../tag/store/tag.actions';
import { WorkContext, WorkContextType } from '../work-context/work-context.model';

@Injectable({
  providedIn: 'root',
})
export class TaskDuplicateService {
  private readonly _taskService = inject(TaskService);
  private readonly _store = inject(Store);
  private readonly _context = this._store.selectSignal(selectActiveWorkContext);
  private readonly _sections = this._store.selectSignal(selectSectionsByContextIdMap);
  private readonly _planner = this._store.selectSignal(selectPlannerState);
  private readonly _tags = this._store.selectSignal(selectTagFeatureState);

  duplicate(task: TaskWithSubTasks): string | null {
    if (task.parentId || task.isDone) {
      return null;
    }

    const taskData = {
      isDone: false,
      projectId: task.projectId || undefined,
      tagIds: task.tagIds || [],
      attachments: task.attachments,
      ...(task.notes && { notes: task.notes }),
      ...(task.deadlineDay && { deadlineDay: task.deadlineDay }),
      ...(task.deadlineWithTime && { deadlineWithTime: task.deadlineWithTime }),
      ...(task.deadlineRemindAt && { deadlineRemindAt: task.deadlineRemindAt }),
      ...(task.priority !== undefined && { priority: task.priority }),
    };
    const timeData = {
      ...(task.dueDay && { dueDay: task.dueDay }),
      ...(task.dueWithTime && { dueWithTime: task.dueWithTime }),
      ...(task.timeEstimate && { timeEstimate: task.timeEstimate }),
    };
    const taskId = this._taskService.add(
      task.title,
      false,
      { ...taskData, ...timeData },
      false,
      true,
    );

    for (const subTask of task.subTasks) {
      const subTaskObj = this._taskService.createNewTaskWithDefaults({
        title: subTask.title,
        additional: {
          parentId: taskId,
          isDone: subTask.isDone,
          ...(isWontDoTask(subTask) && {
            doneOn: subTask.doneOn,
            wontDoOn: subTask.wontDoOn,
          }),
          projectId: subTask.projectId,
          ...(subTask.dueDay && { dueDay: subTask.dueDay }),
          ...(subTask.dueWithTime && { dueWithTime: subTask.dueWithTime }),
          timeEstimate: subTask.timeEstimate,
          notes: subTask.notes,
          attachments: subTask.attachments,
          ...(subTask.deadlineDay && { deadlineDay: subTask.deadlineDay }),
          ...(subTask.deadlineWithTime && { deadlineWithTime: subTask.deadlineWithTime }),
          ...(subTask.deadlineRemindAt && { deadlineRemindAt: subTask.deadlineRemindAt }),
          ...(subTask.priority !== undefined && { priority: subTask.priority }),
        },
      });
      this._store.dispatch(
        addSubTask({
          task: subTaskObj,
          parentId: taskId,
        }),
      );
      if (subTask.dueDay) {
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task: subTaskObj,
            day: subTask.dueDay,
          }),
        );
      }
    }

    this._placeCopy(task, taskId);
    return taskId;
  }

  private _placeCopy(task: TaskWithSubTasks, copyId: string): void {
    if (task.dueDay) {
      const ids = this._planner().days[task.dueDay] || [];
      const fromIndex = ids.indexOf(copyId);
      const originalIndex = ids.indexOf(task.id);
      if (fromIndex >= 0 && originalIndex >= 0) {
        this._store.dispatch(
          PlannerActions.moveInList({
            targetDay: task.dueDay,
            fromIndex,
            toIndex: originalIndex + (fromIndex > originalIndex ? 1 : 0),
          }),
        );
      }
    }
    const context = this._context();
    const section = this._sections()
      .get(context.id)
      ?.find((s) => s.taskIds.includes(task.id));
    if (section) {
      this._store.dispatch(
        addTaskToSection({
          sectionId: section.id,
          taskId: copyId,
          afterTaskId: task.id,
          sourceSectionId: null,
        }),
      );
    } else if (context.backlogTaskIds?.includes(task.id)) {
      this._store.dispatch(
        moveProjectTaskToBacklogList({
          taskId: copyId,
          afterTaskId: task.id,
          workContextId: context.id,
        }),
      );
    } else if (context.taskIds.includes(task.id)) {
      this._ensureStoredTagOrder(context, task.id);
      this._store.dispatch(
        moveTaskInTodayList({
          taskId: copyId,
          afterTaskId: task.id,
          workContextId: context.id,
          workContextType: context.type,
          src: 'UNDONE',
          target: 'UNDONE',
        }),
      );
    }
  }

  private _ensureStoredTagOrder(context: WorkContext, originalId: string): void {
    if (context.type !== WorkContextType.TAG) return;
    const stored = this._tags().entities[context.id]!.taskIds;
    const known = new Set(stored);
    if (known.has(originalId)) return;
    // Derived Today membership can contain tasks without stored ordering entries.
    this._store.dispatch(
      updateTag({
        tag: {
          id: context.id,
          changes: {
            taskIds: [...stored, ...context.taskIds.filter((id) => !known.has(id))],
          },
        },
        isSkipSnack: true,
      }),
    );
  }
}
