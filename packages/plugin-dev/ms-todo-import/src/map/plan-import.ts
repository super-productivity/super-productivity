import { BatchOperation } from '@super-productivity/plugin-api';
import { MsTodoImportModel, MsTodoTask } from '../parse/normalized-model';

/**
 * Batch chunk size. Must stay ≤ the host's MAX_BATCH_OPERATIONS_SIZE (50):
 * the plugin chunks its own `batchUpdateForProject` calls and awaits each one,
 * so every call is a single dispatched action in its own tick (sync rule #6);
 * the bridge's internal chunking would fire all chunks in one tick.
 */
export const BATCH_CHUNK_SIZE = 50;

/** Temp IDs MUST be `temp-`-prefixed — the batch reducer only resolves parent
 * references with this prefix; anything else orphans (= deletes) sub-tasks. */
const tempId = (extId: string): string => `temp-${extId}`;

/** Title of SP's built-in Eisenhower tag. `ensureTags` reuses that tag by its
 * id (it may have been renamed), so starred tasks land in the existing quadrant. */
export const IMPORTANT_TAG_TITLE = 'important';

export interface TaskFollowUp {
  tempId: string;
  dueDay?: string;
  /** resolved to tag IDs at run time (existing tags are reused by title) */
  tagTitles?: string[];
  /** set up after the due date, which the repeat starts from */
  repeat?: MsTodoTask['repeat'];
}

export interface ProjectImportPlan {
  extId: string;
  title: string;
  taskCount: number;
  subTaskCount: number;
  batchChunks: BatchOperation[][];
  followUps: TaskFollowUp[];
}

export interface ImportPlan {
  projects: ProjectImportPlan[];
  /** all tag titles the import needs (categories + the opt-in `important` tag) */
  tagTitles: string[];
}

export interface PlanImportOptions {
  /** tag starred (importance `high`) tasks with SP's `important` tag */
  isTagImportant: boolean;
  /** omit to import everything */
  selectedProjectExtIds?: ReadonlySet<string>;
}

export const groupTasksByProject = (
  model: MsTodoImportModel,
): Map<string, MsTodoTask[]> => {
  const byProject = new Map<string, MsTodoTask[]>();
  for (const t of model.tasks) {
    const list = byProject.get(t.projectExtId) || [];
    list.push(t);
    byProject.set(t.projectExtId, list);
  }
  return byProject;
};

const taskTagTitles = (task: MsTodoTask, isTagImportant: boolean): string[] => {
  // SP sub-tasks cannot hold tags (host model) — the plugin must enforce this
  if (task.parentExtId) {
    return [];
  }
  const titles = [...task.categories];
  if (isTagImportant && task.isImportant) {
    titles.push(IMPORTANT_TAG_TITLE);
  }
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = title.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Project titles must stay unique enough to review: duplicates get a numeric
 * suffix. The default "Tasks" list becomes `Tasks (Microsoft To Do)` so it is
 * recognizable among existing projects.
 *
 * Exported so the preview shows (and collision-checks) exactly the titles the
 * import will create.
 */
export const buildProjectTitles = (model: MsTodoImportModel): Map<string, string> => {
  const baseTitles = new Map(
    model.projects.map((p) => [
      p.extId,
      p.isDefault ? `${p.title} (Microsoft To Do)` : p.title,
    ]),
  );
  const reserved = new Set([...baseTitles.values()].map((title) => title.toLowerCase()));
  const used = new Set<string>();
  const titles = new Map<string, string>();
  for (const p of model.projects) {
    const base = baseTitles.get(p.extId) as string;
    let title = base;
    let suffix = 2;
    while (used.has(title.toLowerCase())) {
      do {
        title = `${base} (${suffix++})`;
      } while (reserved.has(title.toLowerCase()) || used.has(title.toLowerCase()));
    }
    used.add(title.toLowerCase());
    titles.set(p.extId, title);
  }
  return titles;
};

/**
 * Normalized model → executable plan. Pure; unit-tested. Operations are
 * ordered parent-before-child (guaranteed by the model's task order), which
 * keeps chunk boundaries safe.
 */
export const planImport = (
  model: MsTodoImportModel,
  options: PlanImportOptions,
): ImportPlan => {
  const titles = buildProjectTitles(model);
  const tagTitles = new Set<string>();
  const projects: ProjectImportPlan[] = [];
  const tasksByProject = groupTasksByProject(model);

  for (const project of model.projects) {
    if (
      options.selectedProjectExtIds &&
      !options.selectedProjectExtIds.has(project.extId)
    ) {
      continue;
    }
    const tasks = tasksByProject.get(project.extId) || [];
    const operations: BatchOperation[] = tasks.map((t) => ({
      type: 'create',
      tempId: tempId(t.extId),
      data: {
        title: t.title,
        notes: t.notes || undefined,
        parentId: t.parentExtId ? tempId(t.parentExtId) : undefined,
        isDone: t.isDone || undefined,
      },
    }));

    const batchChunks: BatchOperation[][] = [];
    for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
      batchChunks.push(operations.slice(i, i + BATCH_CHUNK_SIZE));
    }

    const followUps: TaskFollowUp[] = [];
    for (const t of tasks) {
      const followUp: TaskFollowUp = { tempId: tempId(t.extId) };
      if (t.dueDay) {
        followUp.dueDay = t.dueDay;
      }
      const titlesForTask = taskTagTitles(t, options.isTagImportant);
      if (titlesForTask.length) {
        followUp.tagTitles = titlesForTask;
        titlesForTask.forEach((title) => tagTitles.add(title));
      }
      if (t.repeat) {
        followUp.repeat = t.repeat;
      }
      if (followUp.dueDay || followUp.tagTitles || followUp.repeat) {
        followUps.push(followUp);
      }
    }

    projects.push({
      extId: project.extId,
      title: titles.get(project.extId) as string,
      taskCount: tasks.filter((t) => !t.parentExtId).length,
      subTaskCount: tasks.filter((t) => !!t.parentExtId).length,
      batchChunks,
      followUps,
    });
  }

  return { projects, tagTitles: [...tagTitles] };
};
