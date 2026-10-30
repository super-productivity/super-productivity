import type {
  PluginCreateTaskData,
  Project,
  Tag,
  Task,
} from '@super-productivity/plugin-api';

// What a card's gestures write. Every function maps one gesture to the one
// plugin API call it makes, so the mapping is tested without the DOM; the UI
// only runs the result. Nothing here reads or writes on its own.

export type CardAction =
  | 'toggleDone'
  | 'toggleTrack'
  | 'editTitle'
  | 'editEstimate'
  | 'addSubTask'
  | 'tags'
  | 'project'
  | 'open'
  | 'delete';

export type MenuView = 'main' | 'tags' | 'project';

export interface MenuEntry {
  /** A CardAction, or `tag:<id>` / `project:<id>` in the sub menus. */
  id: string;
  label: string;
  icon: string;
  /** The shortcut that does the same on a focused card. */
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  hasSubMenu?: boolean;
  separatorBefore?: boolean;
}

export interface MenuCtx {
  task: Task;
  isTracking: boolean;
  canTrack: boolean;
  tags: Tag[];
  projects: Project[];
}

const MINUTE = 60_000;
// A typo like "999999h" would otherwise be written as the estimate.
const MAX_ESTIMATE_MS = 1000 * 60 * MINUTE;

/**
 * "1h 30m", "45m", "1.5h" and a bare number of minutes become milliseconds; an
 * empty text is 0, which clears the estimate; anything else is null.
 */
export const parseDuration = (text: string): number | null => {
  const raw = text.trim().toLowerCase();
  if (!raw) return 0;
  const parts = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?$/.exec(raw);
  const bare = /^\d+(?:\.\d+)?$/.test(raw);
  if (!bare && (!parts || (parts[1] === undefined && parts[2] === undefined))) {
    return null;
  }
  const minutes = bare
    ? Number(raw)
    : Number(parts![1] ?? 0) * 60 + Number(parts![2] ?? 0);
  const ms = Math.round(minutes * MINUTE);
  return ms <= MAX_ESTIMATE_MS ? ms : null;
};

/** Whether a gesture applies to this task, for the menu and the shortcuts alike. */
export const isAvailable = (
  action: CardAction,
  task: Task,
  canTrack: boolean,
): boolean => {
  switch (action) {
    case 'toggleTrack':
      return canTrack && !task.isDone;
    case 'editEstimate':
      // A parent's time is the sum of its sub-tasks.
      return task.subTaskIds.length === 0;
    case 'addSubTask':
    case 'tags':
    case 'project':
      // Sub-tasks have no sub-tasks or tags, and move with their parent.
      return !task.parentId;
    default:
      return true;
  }
};

/** The new title, or null when it is empty or unchanged (the edit is dropped). */
export const titleChange = (task: Task, text: string): Partial<Task> | null => {
  const title = text.trim();
  return title && title !== task.title ? { title } : null;
};

export const estimateChange = (task: Task, ms: number): Partial<Task> | null =>
  ms === task.timeEstimate ? null : { timeEstimate: ms };

export const tagToggle = (task: Task, tagId: string): Partial<Task> => ({
  tagIds: task.tagIds.includes(tagId)
    ? task.tagIds.filter((id) => id !== tagId)
    : [...task.tagIds, tagId],
});

/** The host gives a sub-task its parent's project and no tags, so only the title goes. */
export const subTaskData = (parent: Task, text: string): PluginCreateTaskData | null => {
  const title = text.trim();
  return title ? { title, parentId: parent.id } : null;
};

const main = (ctx: MenuCtx): MenuEntry[] => {
  const { task } = ctx;
  const entries: MenuEntry[] = [
    {
      id: 'toggleDone',
      icon: 'check',
      label: task.isDone ? 'Mark as not done' : 'Mark as done',
      hint: 'D',
    },
  ];
  if (isAvailable('toggleTrack', task, ctx.canTrack)) {
    entries.push({
      id: 'toggleTrack',
      icon: ctx.isTracking ? 'pause' : 'play',
      label: ctx.isTracking ? 'Stop tracking' : 'Start tracking',
      hint: 'Y',
    });
  }
  entries.push({ id: 'editTitle', icon: 'edit', label: 'Edit title', hint: 'Enter' });
  if (isAvailable('editEstimate', task, ctx.canTrack)) {
    entries.push({
      id: 'editEstimate',
      icon: 'hourglass',
      label: 'Set estimate',
      hint: 'T',
    });
  }
  if (isAvailable('addSubTask', task, ctx.canTrack)) {
    entries.push({ id: 'addSubTask', icon: 'add', label: 'Add sub-task', hint: 'A' });
  }
  if (isAvailable('tags', task, ctx.canTrack)) {
    entries.push({ id: 'tags', icon: 'tag', label: 'Tags', hint: 'G', hasSubMenu: true });
    entries.push({
      id: 'project',
      icon: 'folder',
      label: 'Move to project',
      hint: 'E',
      hasSubMenu: true,
    });
  }
  entries.push(
    {
      id: 'open',
      icon: 'panel',
      label: 'Open details',
      hint: 'I',
      separatorBefore: true,
    },
    {
      id: 'delete',
      icon: 'delete',
      label: 'Delete task',
      hint: 'Backspace',
      danger: true,
      separatorBefore: true,
    },
  );
  return entries;
};

/** The entries of one level of a card's context menu. */
export const menuEntries = (view: MenuView, ctx: MenuCtx): MenuEntry[] => {
  if (view === 'tags') {
    return (
      ctx.tags
        // TODAY is virtual: membership comes from the due day, never from tagIds.
        .filter((t) => t.id !== 'TODAY')
        .map((t) => ({
          id: `tag:${t.id}`,
          icon: 'tag',
          label: t.title,
          checked: ctx.task.tagIds.includes(t.id),
        }))
    );
  }
  if (view === 'project') {
    return ctx.projects
      .filter((p) => !p.isArchived)
      .map((p) => ({
        id: `project:${p.id}`,
        icon: 'folder',
        label: p.title,
        checked: p.id === ctx.task.projectId,
      }));
  }
  return main(ctx);
};
