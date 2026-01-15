import { createActionGroup } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { IssueDataReduced } from '../../features/issue/issue.model';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { BatchOperation } from '@super-productivity/plugin-api';
import { PersistentActionMeta } from '../../op-log/core/persistent-action.interface';
import { OpType } from '../../op-log/core/operation.types';

/**
 * Shared actions that affect multiple reducers (tasks, projects, tags)
 * These actions are handled by the task-shared meta-reducer
 */
export const TaskSharedActions = createActionGroup({
  source: 'Task Shared',
  events: {
    // Task Management
    addTask: (taskProps: {
      task: Task;
      issue?: IssueDataReduced;
      workContextId: string;
      workContextType: WorkContextType;
      isAddToBacklog: boolean;
      isAddToBottom: boolean;
      isIgnoreShortSyntax?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Create,
      } satisfies PersistentActionMeta,
    }),

    convertToMainTask: (taskProps: {
      task: Task;
      parentTagIds: string[];
      isPlanForToday?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    deleteTask: (taskProps: { task: TaskWithSubTasks }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Delete,
      } satisfies PersistentActionMeta,
    }),

    deleteTasks: (taskProps: { taskIds: string[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: taskProps.taskIds,
        opType: OpType.Delete,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // TODO rename to `moveTaskToArchive__` to indicate it should not be called directly
    // Note: Full task payload is required for sync reliability.
    // Remote clients need task data to write to their local archive.
    // See docs/archive-operation-redesign.md for detailed analysis.
    moveToArchive: (taskProps: { tasks: TaskWithSubTasks[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: taskProps.tasks.map((t) => t.id),
        opType: OpType.Update,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    restoreTask: (taskProps: { task: Task | TaskWithSubTasks; subTasks: Task[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Restore a deleted task (undo delete) - syncs across devices
    restoreDeletedTask: (payload: {
      task: TaskWithSubTasks;
      projectContext?: {
        projectId: string;
        taskIdsForProject: string[];
        taskIdsForProjectBacklog: string[];
      };
      parentContext?: {
        parentTaskId: string;
        subTaskIds: string[];
      };
      tagTaskIdMap: Record<string, string[]>;
      deletedTaskEntities: Record<string, Task | undefined>;
    }) => ({
      ...payload,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: payload.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Task Scheduling
    scheduleTaskWithTime: (taskProps: {
      task: Task;
      dueWithTime: number;
      remindAt?: number;
      isMoveToBacklog: boolean;
      isSkipAutoRemoveFromToday?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    reScheduleTaskWithTime: (taskProps: {
      task: Task;
      dueWithTime: number;
      remindAt?: number;
      isMoveToBacklog: boolean;
      isSkipAutoRemoveFromToday?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    unscheduleTask: (taskProps: {
      id: string;
      isSkipToast?: boolean;
      isLeaveInToday?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    dismissReminderOnly: (taskProps: { id: string }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Task Updates
    updateTask: (taskProps: { task: Update<Task>; isIgnoreShortSyntax?: boolean }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id as string,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    // Bulk task update - creates single operation instead of N operations
    // Critical for repeating task config updates that affect many archived instances
    updateTasks: (taskProps: { tasks: Update<Task>[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: taskProps.tasks.map((t) => t.id as string),
        opType: OpType.Update,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // Project Management
    moveToOtherProject: (taskProps: {
      task: TaskWithSubTasks;
      targetProjectId: string;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    deleteProject: (taskProps: {
      projectId: string;
      noteIds: string[];
      allTaskIds: string[];
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'PROJECT',
        entityId: taskProps.projectId,
        opType: OpType.Delete,
      } satisfies PersistentActionMeta,
    }),

    // Today Tag Management
    planTasksForToday: (taskProps: {
      taskIds: string[];
      parentTaskMap?: { [taskId: string]: string | undefined };
      isShowSnack?: boolean;
      isSkipRemoveReminder?: boolean;
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: taskProps.taskIds,
        opType: OpType.Update,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    removeTasksFromTodayTag: (taskProps: { taskIds: string[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: taskProps.taskIds,
        opType: OpType.Update,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // Tag Management
    addTagToTask: (props: { tagId: string; taskId: string }) => ({
      ...props,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: [props.taskId, props.tagId],
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),

    removeTagsForAllTasks: (taskProps: { tagIdsToRemove: string[] }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TAG',
        entityIds: taskProps.tagIdsToRemove,
        opType: OpType.Update,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    moveTaskInTodayTagList: (taskProps: { toTaskId: string; fromTaskId: string }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityIds: [taskProps.toTaskId, taskProps.fromTaskId],
        opType: OpType.Move,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // Batch Operations
    batchUpdateForProject: (taskProps: {
      projectId: string;
      operations: BatchOperation[];
      createdTaskIds: { [tempId: string]: string };
    }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'PROJECT',
        entityId: taskProps.projectId,
        opType: OpType.Batch,
      } satisfies PersistentActionMeta,
    }),

    // Issue Provider Management
    deleteIssueProvider: (props: {
      issueProviderId: string;
      taskIdsToUnlink: string[];
    }) => ({
      ...props,
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityId: props.issueProviderId,
        opType: OpType.Delete,
      } satisfies PersistentActionMeta,
    }),

    deleteIssueProviders: (props: { ids: string[]; taskIdsToUnlink: string[] }) => ({
      ...props,
      meta: {
        isPersistent: true,
        entityType: 'ISSUE_PROVIDER',
        entityIds: props.ids,
        opType: OpType.Delete,
        isBulk: true,
      } satisfies PersistentActionMeta,
    }),

    // Task Repeat Config Management
    deleteTaskRepeatCfg: (props: {
      taskRepeatCfgId: string;
      taskIdsToUnlink: string[];
    }) => ({
      ...props,
      meta: {
        isPersistent: true,
        entityType: 'TASK_REPEAT_CFG',
        entityId: props.taskRepeatCfgId,
        opType: OpType.Delete,
      } satisfies PersistentActionMeta,
    }),

    // Short Syntax - Atomic compound action
    // Combines task updates, project moves, and scheduling into one atomic operation
    applyShortSyntax: (props: {
      task: Task;
      taskChanges: Partial<Task>;
      targetProjectId?: string;
      schedulingInfo?: {
        day?: string;
        isAddToTop?: boolean;
        dueWithTime?: number;
        remindAt?: number | null;
        isMoveToBacklog?: boolean;
      };
    }) => ({
      ...props,
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        entityId: props.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),
  },
});
