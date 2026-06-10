import { Project } from '../../project/project.model';
import { Task } from '../task.model';

export interface ProjectWithTasks {
  id: string | null;
  title?: string;
  color?: string;
  tasks: Task[];
  timeSpentToday: number;
  timeSpentYesterday?: number;
}

export const mapToProjectWithTasks = (
  project: Project | { id: string | null; title: string },
  flatTasks: Task[],
  todayStr: string,
  yesterdayStr?: string,
): ProjectWithTasks => {
  // NOTE: this only works, because projectIds is only triggered before assign flatTasks
  const tasks = flatTasks.filter((task) =>
    task.projectId ? task.projectId === project.id : project.id === null,
  );
  const timeSpentToday = tasks.reduce((acc: number, task) => {
    return acc + ((!task.parentId && task.timeSpentOnDay?.[todayStr]) || 0);
  }, 0);

  const timeSpentYesterday = yesterdayStr
    ? tasks.reduce((acc: number, task) => {
        return acc + ((!task.parentId && task.timeSpentOnDay?.[yesterdayStr]) || 0);
      }, 0)
    : undefined;

  return {
    id: project.id,
    title: project.title,
    color: (project as Project)?.theme?.primary,
    tasks,
    timeSpentToday,
    timeSpentYesterday,
  };
};
