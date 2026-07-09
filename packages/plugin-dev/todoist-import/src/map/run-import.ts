import { PluginAPI, Task } from '@super-productivity/plugin-api';
import { ImportPlan, ProjectImportPlan } from './plan-import';

export interface ImportProgress {
  projectTitle: string;
  projectIndex: number;
  totalProjects: number;
  phase: 'project' | 'tasks' | 'details';
}

export interface ImportedProjectResult {
  title: string;
  projectId: string;
  /** counted from re-read state — the batch API is fire-and-forget */
  landedTaskCount: number;
}

export interface ImportResult {
  imported: ImportedProjectResult[];
  createdTagTitles: string[];
  /** set when the import aborted mid-way (already-imported projects stay) */
  failedProjectTitle: string | null;
  errorMessage: string | null;
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
): Promise<{ tagIdByTitle: Map<string, string>; createdTagTitles: string[] }> => {
  const tagIdByTitle = new Map<string, string>();
  const existing = await api.getAllTags();
  for (const tag of existing) {
    tagIdByTitle.set(tag.title.toLowerCase(), tag.id);
  }
  const createdTagTitles: string[] = [];
  for (const title of tagTitles) {
    const key = title.toLowerCase();
    if (!tagIdByTitle.has(key)) {
      tagIdByTitle.set(key, await api.addTag({ title }));
      createdTagTitles.push(title);
    }
  }
  return { tagIdByTitle, createdTagTitles };
};

const importProject = async (
  api: ImportApi,
  projectPlan: ProjectImportPlan,
  tagIdByTitle: Map<string, string>,
  onPhase: (phase: ImportProgress['phase']) => void,
): Promise<string> => {
  onPhase('project');
  const projectId = await api.addProject({ title: projectPlan.title });

  onPhase('tasks');
  const idByTempId: Record<string, string> = {};
  for (const chunk of projectPlan.batchChunks) {
    // sequential awaits: one dispatched action per tick (sync rule #6)
    const result = await api.batchUpdateForProject({ projectId, operations: chunk });
    Object.assign(idByTempId, result.createdTaskIds);
  }

  onPhase('details');
  for (const followUp of projectPlan.followUps) {
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

/**
 * Executes the plan project-by-project so an abort leaves whole projects, and
 * counts what actually landed by re-reading state (`batchUpdateForProject`
 * always reports success and silently skips invalid operations).
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
  };

  try {
    const { tagIdByTitle, createdTagTitles } = await ensureTags(api, plan.tagTitles);
    result.createdTagTitles = createdTagTitles;

    for (let i = 0; i < plan.projects.length; i++) {
      const projectPlan = plan.projects[i];
      const report = (phase: ImportProgress['phase']): void =>
        onProgress({
          projectTitle: projectPlan.title,
          projectIndex: i,
          totalProjects: plan.projects.length,
          phase,
        });
      try {
        const projectId = await importProject(api, projectPlan, tagIdByTitle, report);
        result.imported.push({ title: projectPlan.title, projectId, landedTaskCount: 0 });
      } catch (e) {
        result.failedProjectTitle = projectPlan.title;
        result.errorMessage = e instanceof Error ? e.message : String(e);
        break;
      }
    }

    const allTasks = await api.getTasks();
    const countByProjectId = new Map<string, number>();
    for (const task of allTasks) {
      if (task.projectId) {
        countByProjectId.set(
          task.projectId,
          (countByProjectId.get(task.projectId) || 0) + 1,
        );
      }
    }
    for (const imported of result.imported) {
      imported.landedTaskCount = countByProjectId.get(imported.projectId) || 0;
    }
  } catch (e) {
    result.errorMessage = e instanceof Error ? e.message : String(e);
  }

  return result;
};
