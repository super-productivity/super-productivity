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

/**
 * Opt-in alternative to the p1–p3 tags: map Todoist's single priority axis onto
 * Super Productivity's built-in Eisenhower-matrix tags. The two tags are reused
 * by title (`ensureTags` matches case-insensitively), so imported tasks land in
 * the existing `EM_URGENT`/`EM_IMPORTANT` quadrants instead of spawning new
 * tags. Collapsing one axis onto the 2-D matrix is inherently opinionated; this
 * is the conventional split and only ever applies when the user explicitly
 * chooses it. API 1 (default p4) stays untagged.
 */
const EISENHOWER_TAGS_BY_API_VALUE: Record<number, readonly string[]> = {
  4: ['urgent', 'important'],
  3: ['important'],
  2: ['urgent'],
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

/**
 * How Todoist task priority is carried over — mutually exclusive (one UI
 * control): `none` leaves priority off, `priorityTags` adds the p1–p3 tags,
 * `eisenhower` adds SP's built-in urgent/important tags.
 */
export type PriorityMapping = 'none' | 'priorityTags' | 'eisenhower';

export interface PlanImportOptions {
  priorityMapping: PriorityMapping;
  /** omit to import everything */
  selectedProjectExtIds?: ReadonlySet<string>;
}

export const groupTasksByProject = (
  model: TodoistImportModel,
): Map<string, TodoistTask[]> => {
  const byProject = new Map<string, TodoistTask[]>();
  for (const t of model.tasks) {
    const list = byProject.get(t.projectExtId) || [];
    list.push(t);
    byProject.set(t.projectExtId, list);
  }
  return byProject;
};

const taskTagTitles = (task: TodoistTask, priorityMapping: PriorityMapping): string[] => {
  // SP sub-tasks cannot hold tags (host model) — the plugin must enforce this
  if (task.parentExtId) {
    return [];
  }
  const titles = [...task.labels];
  if (priorityMapping === 'priorityTags') {
    const priorityTag = PRIORITY_TAG_BY_API_VALUE[task.apiPriority];
    if (priorityTag) {
      titles.push(priorityTag);
    }
  } else if (priorityMapping === 'eisenhower') {
    const emTags = EISENHOWER_TAGS_BY_API_VALUE[task.apiPriority];
    if (emTags) {
      titles.push(...emTags);
    }
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
 * Flattened project titles must stay unique enough to review: nested projects
 * keep their plain name unless it collides, then `Parent / Child`; remaining
 * duplicates get a numeric suffix. The Todoist Inbox becomes `Inbox (Todoist)`
 * so it never shadows SP's own Inbox.
 *
 * Exported so the preview shows (and collision-checks) exactly the titles the
 * import will create.
 */
export const buildProjectTitles = (model: TodoistImportModel): Map<string, string> => {
  const byExtId = new Map(model.projects.map((p) => [p.extId, p]));
  const preferredTitles = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const p of model.projects) {
    const base = p.isInbox ? 'Inbox (Todoist)' : p.title;
    const key = base.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    preferredTitles.set(p.extId, base);
  }
  for (const p of model.projects) {
    let title = preferredTitles.get(p.extId) as string;
    if ((counts.get(title.toLowerCase()) || 0) > 1 && p.parentExtId) {
      const parent = byExtId.get(p.parentExtId);
      if (parent) {
        title = `${parent.title} / ${title}`;
      }
    }
    preferredTitles.set(p.extId, title);
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
      const titlesForTask = taskTagTitles(t, options.priorityMapping);
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
