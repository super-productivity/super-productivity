import { Task } from './task.model';
import { Project } from '../project/project.model';
import { TaskListWidgetTask } from '../../../../electron/shared-with-frontend/task-list-widget.model';

/** Read-only projection: never export notes, attachments or issue credentials. */
export const getTaskListWidgetTasks = (
  tasks: Task[],
  projects: Project[],
  todayIds: string[],
  filter: 'all' | 'today',
): TaskListWidgetTask[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byProject = new Map(projects.map((project) => [project.id, project]));
  const ordered = filter === 'today' ? todayIds.map((id) => byId.get(id)) : tasks;
  return ordered
    .filter(
      (task): task is Task =>
        !!task &&
        !task.isDone &&
        !task.parentId &&
        !byProject.get(task.projectId)?.isArchived,
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      projectTitle: byProject.get(task.projectId)?.title ?? '',
      timeEstimate: task.timeEstimate,
      subTasks: task.subTaskIds
        .map((id) => byId.get(id))
        .filter((child): child is Task => !!child && !child.isDone)
        .map((child) => ({ id: child.id, title: child.title })),
    }));
};
