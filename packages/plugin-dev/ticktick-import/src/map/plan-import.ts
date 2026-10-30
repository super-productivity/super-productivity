import { BatchOperation } from '@super-productivity/plugin-api';
import { TickTickImportModel, TickTickTask } from '../parse/normalized-model';

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

/** TickTick priority (5 = high) → SP tag title. 0 = none is never tagged. */
const PRIORITY_TAG_BY_VALUE: Record<number, string> = {
  5: 'p1',
  3: 'p2',
  1: 'p3',
};

/**
 * Opt-in alternative to the p1–p3 tags: map TickTick's single priority axis
 * onto Super Productivity's built-in Eisenhower-matrix tags (reused by title,
 * so tasks land in the existing quadrants). Same split as the Todoist importer.
 */
const EISENHOWER_TAGS_BY_VALUE: Record<number, readonly string[]> = {
  5: ['urgent', 'important'],
  3: ['important'],
  1: ['urgent'],
};

export interface TaskFollowUp {
  tempId: string;
  dueDay?: string;
  dueWithTime?: number;
  /** resolved to tag IDs at run time (existing tags are reused by title) */
  tagTitles?: string[];
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
  /** all tag titles the import needs (used tags + opt-in priority tags) */
  tagTitles: string[];
}

export type PriorityMapping = 'none' | 'priorityTags' | 'eisenhower';

export interface PlanImportOptions {
  priorityMapping: PriorityMapping;
  /** omit to import everything */
  selectedProjectExtIds?: ReadonlySet<string>;
}

export const groupTasksByProject = (
  model: TickTickImportModel,
): Map<string, TickTickTask[]> => {
  const byProject = new Map<string, TickTickTask[]>();
  for (const t of model.tasks) {
    const list = byProject.get(t.projectExtId) || [];
    list.push(t);
    byProject.set(t.projectExtId, list);
  }
  return byProject;
};

const taskTagTitles = (
  task: TickTickTask,
  priorityMapping: PriorityMapping,
): string[] => {
  // SP sub-tasks cannot hold tags (host model) — the plugin must enforce this
  if (task.parentExtId) {
    return [];
  }
  const titles = [...task.tags];
  if (priorityMapping === 'priorityTags' && PRIORITY_TAG_BY_VALUE[task.priority]) {
    titles.push(PRIORITY_TAG_BY_VALUE[task.priority]);
  } else if (
    priorityMapping === 'eisenhower' &&
    EISENHOWER_TAGS_BY_VALUE[task.priority]
  ) {
    titles.push(...EISENHOWER_TAGS_BY_VALUE[task.priority]);
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
 * Lists keep their plain name unless it collides (same list name in two
 * folders), then `Folder / List`; remaining duplicates get a numeric suffix.
 * The TickTick Inbox becomes `Inbox (TickTick)` so it never shadows SP's own
 * Inbox.
 *
 * Exported so the preview shows (and collision-checks) exactly the titles the
 * import will create.
 */
export const buildProjectTitles = (model: TickTickImportModel): Map<string, string> => {
  const counts = new Map<string, number>();
  const preferredTitles = new Map<string, string>();
  for (const p of model.projects) {
    const base = p.isInbox ? 'Inbox (TickTick)' : p.title;
    counts.set(base.toLowerCase(), (counts.get(base.toLowerCase()) || 0) + 1);
    preferredTitles.set(p.extId, base);
  }
  for (const p of model.projects) {
    const base = preferredTitles.get(p.extId) as string;
    if ((counts.get(base.toLowerCase()) || 0) > 1 && p.folderTitle) {
      preferredTitles.set(p.extId, `${p.folderTitle} / ${base}`);
    }
  }

  const reserved = new Set(
    [...preferredTitles.values()].map((title) => title.toLowerCase()),
  );
  const used = new Set<string>();
  const titles = new Map<string, string>();
  for (const p of model.projects) {
    const base = preferredTitles.get(p.extId) as string;
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

const toFollowUp = (
  task: TickTickTask,
  priorityMapping: PriorityMapping,
): TaskFollowUp | null => {
  const followUp: TaskFollowUp = { tempId: tempId(task.extId) };
  if (task.dueDay) {
    followUp.dueDay = task.dueDay;
  } else if (task.dueWithTime) {
    followUp.dueWithTime = task.dueWithTime;
  }
  const tagTitles = taskTagTitles(task, priorityMapping);
  if (tagTitles.length) {
    followUp.tagTitles = tagTitles;
  }
  return followUp.dueDay || followUp.dueWithTime || followUp.tagTitles ? followUp : null;
};

/**
 * Normalized model → executable plan. Pure; unit-tested. Operations are
 * ordered parent-before-child (guaranteed by the model's task order), which
 * keeps chunk boundaries safe.
 */
export const planImport = (
  model: TickTickImportModel,
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
        isDone: t.isDone || undefined,
        parentId: t.parentExtId ? tempId(t.parentExtId) : undefined,
      },
    }));

    const batchChunks: BatchOperation[][] = [];
    for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
      batchChunks.push(operations.slice(i, i + BATCH_CHUNK_SIZE));
    }

    const followUps: TaskFollowUp[] = [];
    for (const t of tasks) {
      const followUp = toFollowUp(t, options.priorityMapping);
      if (followUp) {
        followUps.push(followUp);
        followUp.tagTitles?.forEach((title) => tagTitles.add(title));
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
