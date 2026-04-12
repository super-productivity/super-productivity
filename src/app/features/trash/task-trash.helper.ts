import { Task, TaskWithSubTasks } from '../tasks/task.model';
import { Project } from '../project/project.model';
import { TaskRestoreContext, TrashedItem, TrashedTask } from './trash.model';

/**
 * Builds one TrashedItem per task (main + each subtask) so that the trash page
 * can display each independently, and so that restore can target individual
 * pieces if needed. The main task carries the backlog flag derived from the
 * current project state.
 */
export const buildTrashedTaskItems = (
  taskWithSub: TaskWithSubTasks,
  project: Project | undefined,
  now: number = Date.now(),
): TrashedItem<Task>[] => {
  const mainTaskBacklog = !!project?.backlogTaskIds?.includes(taskWithSub.id);

  const mainItem: TrashedTask = {
    id: taskWithSub.id,
    entityType: 'TASK',
    data: stripSubTasks(taskWithSub),
    restoreContext: {
      projectId: taskWithSub.projectId || undefined,
      tagIds: [...taskWithSub.tagIds],
      parentId: taskWithSub.parentId || undefined,
      subTaskIds: [...(taskWithSub.subTaskIds || [])],
      backlog: mainTaskBacklog,
    } satisfies TaskRestoreContext,
    deletedAt: now,
  };

  const subItems: TrashedTask[] = (taskWithSub.subTasks || []).map((sub) => ({
    id: sub.id,
    entityType: 'TASK',
    data: sub,
    restoreContext: {
      projectId: sub.projectId || undefined,
      tagIds: [...sub.tagIds],
      parentId: taskWithSub.id,
      subTaskIds: [],
      backlog: false,
    } satisfies TaskRestoreContext,
    deletedAt: now,
  }));

  return [mainItem, ...subItems];
};

// Remove subTasks from Task — the subTasks field lives on TaskWithSubTasks only
// and is redundant since subtasks are stored as their own trashed items.
const stripSubTasks = (t: TaskWithSubTasks): Task => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { subTasks, ...rest } = t;
  return rest as Task;
};
