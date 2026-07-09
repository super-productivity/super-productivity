import { BatchOperation } from '@super-productivity/plugin-api';
import { TodoistImportModel, TodoistTask } from '../parse/normalized-model';

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

/** Todoist API priority (4 = highest) → SP tag title. API 1 = the default on
 * every task and is deliberately never tagged. */
const PRIORITY_TAG_BY_API_VALUE: Record<number, string> = {
  4: 'p1',
  3: 'p2',
  2: 'p3',
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
  /** all tag titles the import needs (used labels + opt-in priority tags) */
  tagTitles: string[];
}

export interface PlanImportOptions {
  isMapPriorityToTags: boolean;
  /** omit to import everything */
  selectedProjectExtIds?: ReadonlySet<string>;
}

const taskTagTitles = (task: TodoistTask, isMapPriorityToTags: boolean): string[] => {
  // SP sub-tasks cannot hold tags (host model) — the plugin must enforce this
  if (task.parentExtId) {
    return [];
  }
  const titles = [...task.labels];
  const priorityTag = isMapPriorityToTags
    ? PRIORITY_TAG_BY_API_VALUE[task.apiPriority]
    : undefined;
  if (priorityTag) {
    titles.push(priorityTag);
  }
  return titles;
};

/**
 * Flattened project titles must stay unique enough to review: nested projects
 * keep their plain name unless it collides, then `Parent / Child`; remaining
 * duplicates get a numeric suffix. The Todoist Inbox becomes `Inbox (Todoist)`
 * so it never shadows SP's own Inbox.
 */
const buildProjectTitles = (model: TodoistImportModel): Map<string, string> => {
  const byExtId = new Map(model.projects.map((p) => [p.extId, p]));
  const titles = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const p of model.projects) {
    const base = p.isInbox ? 'Inbox (Todoist)' : p.title;
    counts.set(base, (counts.get(base) || 0) + 1);
    titles.set(p.extId, base);
  }
  const used = new Map<string, number>();
  for (const p of model.projects) {
    let title = titles.get(p.extId) as string;
    if ((counts.get(title) || 0) > 1 && p.parentExtId) {
      const parent = byExtId.get(p.parentExtId);
      if (parent) {
        title = `${parent.title} / ${title}`;
      }
    }
    const seen = used.get(title) || 0;
    used.set(title, seen + 1);
    if (seen > 0) {
      title = `${title} (${seen + 1})`;
    }
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
  model: TodoistImportModel,
  options: PlanImportOptions,
): ImportPlan => {
  const titles = buildProjectTitles(model);
  const tagTitles = new Set<string>();
  const projects: ProjectImportPlan[] = [];

  for (const project of model.projects) {
    if (
      options.selectedProjectExtIds &&
      !options.selectedProjectExtIds.has(project.extId)
    ) {
      continue;
    }
    const tasks = model.tasks.filter((t) => t.projectExtId === project.extId);
    const operations: BatchOperation[] = tasks.map((t) => ({
      type: 'create',
      tempId: tempId(t.extId),
      data: {
        title: t.title,
        notes: t.notes || undefined,
        parentId: t.parentExtId ? tempId(t.parentExtId) : undefined,
        timeEstimate: t.timeEstimate ?? undefined,
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
      } else if (t.dueWithTime) {
        followUp.dueWithTime = t.dueWithTime;
      }
      const titlesForTask = taskTagTitles(t, options.isMapPriorityToTags);
      if (titlesForTask.length) {
        followUp.tagTitles = titlesForTask;
        titlesForTask.forEach((title) => tagTitles.add(title));
      }
      if (followUp.dueDay || followUp.dueWithTime || followUp.tagTitles) {
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
