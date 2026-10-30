import type { PluginAPI, Tag, Task } from '@super-productivity/plugin-api';
import type { ModelEnv } from '../core/cards';
import { newTaskData, type Creation } from '../core/creation';
import {
  estimateChange,
  subTaskData,
  tagToggle,
  titleChange,
} from '../core/task-actions';

declare const PluginAPI: PluginAPI;

// What a card's gestures do. Each one is a single user action and a single
// plugin API call; nothing here runs on render or hover. The list is patched
// first so it answers at once, and a failed write reloads the real data.

export interface ActionDeps {
  env(): ModelEnv | null;
  patch(id: string, changes: Partial<Task>): void;
  setCurrent(taskId: string | null): void;
  /** A tag this view just created, known before the next data refresh. */
  registerTag(tag: Tag): void;
  /** The host shows this task in its detail panel now. */
  setSelected(taskId: string): void;
  /** Draws the view again from the patched data. */
  repaint(): void;
  /** Runs a write; a failure is shown and the data reloaded. */
  run(write: () => Promise<unknown>): Promise<void>;
  canTrack: boolean;
}

export interface CardActions {
  toggleDone(id: string): void;
  toggleTrack(id: string): void;
  saveTitle(id: string, text: string): void;
  saveEstimate(id: string, ms: number): void;
  toggleTag(id: string, tagId: string): void;
  moveToProject(id: string, projectId: string): void;
  addSubTask(parentId: string, text: string): void;
  addInLane(creation: Creation, text: string): void;
  open(id: string): void;
  remove(id: string): void;
}

export const createCardActions = (deps: ActionDeps): CardActions => {
  const taskOf = (id: string): Task | undefined =>
    deps.env()?.tasks.find((t) => t.id === id);

  const write = (id: string, changes: Partial<Task> | null): void => {
    if (!changes) return;
    deps.patch(id, changes);
    deps.repaint();
    void deps.run(() => PluginAPI.updateTask(id, changes));
  };

  const edit = (id: string, make: (task: Task) => Partial<Task> | null): void => {
    const task = taskOf(id);
    if (task) write(id, make(task));
  };

  return {
    toggleDone: (id) => edit(id, (t) => ({ isDone: !t.isDone })),
    toggleTrack: (id) => {
      const env = deps.env();
      if (!env || !deps.canTrack) return;
      const isTracking = env.currentTaskId === id;
      deps.setCurrent(isTracking ? null : id);
      deps.repaint();
      void deps.run(() =>
        isTracking ? PluginAPI.stopTracking!() : PluginAPI.startTracking!(id),
      );
    },
    saveTitle: (id, text) => edit(id, (t) => titleChange(t, text)),
    saveEstimate: (id, ms) => edit(id, (t) => estimateChange(t, ms)),
    toggleTag: (id, tagId) => edit(id, (t) => tagToggle(t, tagId)),
    moveToProject: (id, projectId) =>
      edit(id, (t) => (t.projectId === projectId ? null : { projectId })),
    addSubTask: (parentId, text) => {
      const parent = taskOf(parentId);
      const data = parent && subTaskData(parent, text);
      if (!data) return;
      // The new row arrives with the next data refresh; nothing to patch.
      void deps.run(() => PluginAPI.addTask(data));
    },
    addInLane: (creation, text) =>
      // The new row arrives with the next data refresh, like a sub-task.
      void deps.run(() => addTaskIn(creation, text, deps)),
    open: (id) =>
      void deps.run(async () => {
        await PluginAPI.selectTask(id);
        deps.setSelected(id);
      }),
    remove: (id) => void confirmDelete(id, taskOf(id)?.title ?? '', deps),
  };
};

// A built-in board tag the lane needs may not exist yet; it is created first,
// as dropping a card on the column would. One Enter is still one addTask.
const addTaskIn = async (
  creation: Creation,
  text: string,
  deps: ActionDeps,
): Promise<void> => {
  let tagIds = creation.tagIds;
  for (const missing of creation.missingTags) {
    const id = await PluginAPI.addTag(missing);
    tagIds = tagIds.map((t) => (t === missing.id ? id : t));
    deps.registerTag({ id, title: missing.title, taskIds: [] } as unknown as Tag);
  }
  await PluginAPI.addTask(newTaskData({ ...creation, tagIds }, text));
};

const confirmDelete = async (
  id: string,
  title: string,
  deps: ActionDeps,
): Promise<void> => {
  const answer = await PluginAPI.openDialog({
    title: 'Delete task',
    content: `Delete "${title}"? Its sub-tasks go with it.`,
    buttons: [{ label: 'Delete', color: 'warn', raised: true }, { label: 'Cancel' }],
  });
  if (answer === 'Delete') await deps.run(() => PluginAPI.deleteTask(id));
};
