import { Project } from '../../project/project.model';
import { Task } from '../task.model';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';
import { isSingleEmoji } from '../../../util/extract-first-emoji';

export interface ProjectWithTasks {
  id: string | null;
  title?: string;
  color?: string;
  icon?: string;
  isEmojiIcon: boolean;
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

  // Same icon fallback as the side nav, so a section reads like its nav entry
  const icon =
    project.id === null ? undefined : (project as Project).icon || DEFAULT_PROJECT_ICON;

  return {
    id: project.id,
    title: project.title,
    color: (project as Project)?.theme?.primary,
    icon,
    isEmojiIcon: !!icon && isSingleEmoji(icon),
    tasks,
    timeSpentToday,
    timeSpentYesterday,
  };
};
