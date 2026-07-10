import { BatchOperation, PluginAPI, Task } from '@super-productivity/plugin-api';
import { ImportPlan, ProjectImportPlan } from './plan-import';

/** SP's virtual Today tag — must never land in task.tagIds (sync rule #5). */
const TODAY_TAG_ID = 'TODAY';

/** Report follow-up progress in steps of this many tasks. */
const DETAIL_PROGRESS_STEP = 25;

export interface ImportProgress {
  projectTitle: string;
  projectIndex: number;
  totalProjects: number;
  phase: 'project' | 'tasks' | 'details';
  /** follow-up progress within the 'details' phase */
  detailIndex?: number;
  detailTotal?: number;
}

export interface ImportedProjectResult {
  title: string;
  projectId: string;
  /** planned counts, for an honest landed-vs-planned comparison */
  plannedTaskCount: number;
  plannedSubTaskCount: number;
  /** counted from re-read state — the batch API is fire-and-forget */
  landedTaskCount: number;
  landedSubTaskCount: number;
}

export interface ImportResult {
  imported: ImportedProjectResult[];
  createdTagTitles: string[];
  /** set when the import aborted mid-way; that project exists PARTIALLY —
   * the user should delete it before re-running */
  failedProjectTitle: string | null;
  errorMessage: string | null;
  /** the post-import recount failed; landed counts are unknown, not zero */
  isCountUnverified: boolean;
}

type ImportApi = Pick<
  PluginAPI,
  | 'getAllTags'
  | 'addTag'
  | 'addProject'
  | 'batchUpdateForProject'
  | 'updateTask'
  | 'getTasks'
>;

const ensureTags = async (
  api: ImportApi,
  tagTitles: string[],
  createdTagTitles: string[],
): Promise<Map<string, string>> => {
  const tagIdByTitle = new Map<string, string>();
  const existing = await api.getAllTags();
  for (const tag of existing) {
    // never map a label onto the virtual Today tag — a Todoist label named
    // "Today" gets a real tag of its own instead
    if (tag.id === TODAY_TAG_ID) {
      continue;
    }
    tagIdByTitle.set(tag.title.toLowerCase(), tag.id);
  }
  for (const title of tagTitles) {
    const key = title.toLowerCase();
    if (!tagIdByTitle.has(key)) {
      tagIdByTitle.set(key, await api.addTag({ title }));
      createdTagTitles.push(title);
    }
  }
  return tagIdByTitle;
};

/**
 * The bridge builds its temp-ID map PER CALL — a chunk sent in a later call
 * cannot resolve a `temp-` parent created by an earlier call (the reducer
 * would store the dangling ref and the consistency pass would orphan-DELETE
 * the child). Real task IDs are supported in `parentId`, so rewrite every
 * already-known temp parent to its real ID before sending.
 */
const resolveKnownParents = (
  chunk: BatchOperation[],
  idByTempId: Record<string, string>,
): BatchOperation[] =>
  chunk.map((op) =>
    op.type === 'create' && op.data.parentId && idByTempId[op.data.parentId]
      ? { ...op, data: { ...op.data, parentId: idByTempId[op.data.parentId] } }
      : op,
  );

const importProject = async (
  api: ImportApi,
  projectPlan: ProjectImportPlan,
  tagIdByTitle: Map<string, string>,
  onProgress: (
    detail: Partial<ImportProgress> & { phase: ImportProgress['phase'] },
  ) => void,
): Promise<string> => {
  onProgress({ phase: 'project' });
  const projectId = await api.addProject({ title: projectPlan.title });

  onProgress({ phase: 'tasks' });
  const idByTempId: Record<string, string> = {};
  for (const chunk of projectPlan.batchChunks) {
    // sequential awaits: one dispatched action per tick (sync rule #6)
    const result = await api.batchUpdateForProject({
      projectId,
      operations: resolveKnownParents(chunk, idByTempId),
    });
    Object.assign(idByTempId, result.createdTaskIds);
  }

  const followUps = projectPlan.followUps;
  for (let i = 0; i < followUps.length; i++) {
    if (i % DETAIL_PROGRESS_STEP === 0) {
      onProgress({ phase: 'details', detailIndex: i, detailTotal: followUps.length });
    }
    const followUp = followUps[i];
    const taskId = idByTempId[followUp.tempId];
    if (!taskId) {
      continue;
    }
    const updates: Partial<Task> = {};
    if (followUp.dueDay) {
      updates.dueDay = followUp.dueDay;
    } else if (followUp.dueWithTime) {
      updates.dueWithTime = followUp.dueWithTime;
    }
    if (followUp.tagTitles?.length) {
      const tagIds = followUp.tagTitles
        .map((t) => tagIdByTitle.get(t.toLowerCase()))
        .filter((id): id is string => !!id);
      if (tagIds.length) {
        updates.tagIds = tagIds;
      }
    }
    if (Object.keys(updates).length) {
      await api.updateTask(taskId, updates);
    }
  }
  return projectId;
};

const countLanded = async (api: ImportApi, result: ImportResult): Promise<void> => {
  const allTasks = await api.getTasks();
  const rootsByProject = new Map<string, number>();
  const subsByProject = new Map<string, number>();
  for (const task of allTasks) {
    if (!task.projectId) {
      continue;
    }
    const target = task.parentId ? subsByProject : rootsByProject;
    target.set(task.projectId, (target.get(task.projectId) || 0) + 1);
  }
  for (const imported of result.imported) {
    imported.landedTaskCount = rootsByProject.get(imported.projectId) || 0;
    imported.landedSubTaskCount = subsByProject.get(imported.projectId) || 0;
  }
};

/**
 * Executes the plan project-by-project so an abort leaves at most one partial
 * project (named in the result), and counts what actually landed by re-reading
 * state (`batchUpdateForProject` always reports success and silently skips
 * invalid operations).
 */
export const runImport = async (
  api: ImportApi,
  plan: ImportPlan,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportResult> => {
  const result: ImportResult = {
    imported: [],
    createdTagTitles: [],
    failedProjectTitle: null,
    errorMessage: null,
    isCountUnverified: false,
  };

  try {
    const tagIdByTitle = await ensureTags(api, plan.tagTitles, result.createdTagTitles);

    for (let i = 0; i < plan.projects.length; i++) {
      const projectPlan = plan.projects[i];
      const report: Parameters<typeof importProject>[3] = (detail) =>
        onProgress({
          projectTitle: projectPlan.title,
          projectIndex: i,
          totalProjects: plan.projects.length,
          ...detail,
        });
      try {
        const projectId = await importProject(api, projectPlan, tagIdByTitle, report);
        result.imported.push({
          title: projectPlan.title,
          projectId,
          plannedTaskCount: projectPlan.taskCount,
          plannedSubTaskCount: projectPlan.subTaskCount,
          landedTaskCount: 0,
          landedSubTaskCount: 0,
        });
      } catch (e) {
        result.failedProjectTitle = projectPlan.title;
        result.errorMessage = e instanceof Error ? e.message : String(e);
        break;
      }
    }
  } catch (e) {
    result.errorMessage = e instanceof Error ? e.message : String(e);
  }

  if (result.imported.length) {
    // a failed recount must not mask a successful import (or the real error)
    try {
      await countLanded(api, result);
    } catch {
      result.isCountUnverified = true;
    }
  }

  return result;
};
