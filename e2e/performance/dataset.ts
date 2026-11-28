/**
 * Deterministic synthetic accounts for the performance benchmark.
 *
 * The output is a partial `AppDataComplete` (task, project, menuTree only).
 * `BackupService.importCompleteBackup` fills every missing slice with the
 * model default (`withDefaultModelSlices`), so settings are the app defaults of
 * the build under test rather than a hand-maintained copy that drifts.
 */
import type { Project } from '../../src/app/features/project/project.model';
import type { Task, TaskState } from '../../src/app/features/tasks/task.model';
import {
  MenuTreeKind,
  type MenuTreeState,
} from '../../src/app/features/menu-tree/store/menu-tree.model';
import { WorklogGrouping } from '../../src/app/features/worklog/worklog.model';

/** Bump when the generated content changes so old results are not compared. */
export const DATASET_VERSION = 1;

export interface Profile {
  name: string;
  totalTasks: number;
  focusTasks: number;
  projects: number;
}

// Each profile changes one dimension relative to the baseline.
export const PROFILES: readonly Profile[] = [
  { name: 'baseline', totalTasks: 1_000, focusTasks: 50, projects: 10 },
  { name: 'large-account', totalTasks: 10_000, focusTasks: 50, projects: 10 },
  { name: 'long-list', totalTasks: 1_000, focusTasks: 900, projects: 10 },
];

export const SOURCE_PROJECT_ID = 'perf-p-source';
export const FOCUS_PROJECT_ID = 'perf-p-focus';
const INBOX_PROJECT_ID = 'INBOX_PROJECT';
const SOURCE_TASK_COUNT = 50;
// 2026-01-01T00:00:00Z: fixed so the generated file is byte-identical per profile.
const CREATED = 1767225600000;

export interface BenchmarkAccount {
  data: {
    task: TaskState;
    project: { ids: string[]; entities: Record<string, Project> };
    menuTree: MenuTreeState;
  };
  focusTaskIds: string[];
  sourceTaskIds: string[];
}

export const taskId = (nr: number): string => `perf-t-${String(nr).padStart(5, '0')}`;
export const taskTitle = (nr: number): string =>
  `Benchmark task ${String(nr).padStart(5, '0')}`;

const createTask = (nr: number, projectId: string): Task => ({
  id: taskId(nr),
  projectId,
  title: taskTitle(nr),
  subTaskIds: [],
  timeSpentOnDay: {},
  timeSpent: 0,
  timeEstimate: 0,
  isDone: false,
  tagIds: [],
  created: CREATED,
  attachments: [],
});

const createProject = (id: string, title: string, taskIds: string[]): Project => ({
  id,
  title,
  taskIds,
  backlogTaskIds: [],
  noteIds: [],
  icon: id === INBOX_PROJECT_ID ? 'inbox' : null,
  isArchived: false,
  isHiddenFromMenu: false,
  isEnableBacklog: false,
  advancedCfg: {
    worklogExportSettings: {
      cols: ['DATE', 'START', 'END', 'TIME_CLOCK', 'TITLES_INCLUDING_SUB'],
      roundWorkTimeTo: null,
      roundStartTimeTo: null,
      roundEndTimeTo: null,
      groupBy: WorklogGrouping.DATE,
      separateTasksBy: ' | ',
    },
  },
  theme: {
    isAutoContrast: true,
    isDisableBackgroundTint: false,
    primary: '#29a1aa',
    huePrimary: '500',
    accent: '#ff4081',
    hueAccent: '500',
    warn: '#e11826',
    hueWarn: '500',
    backgroundImageDark: null,
    backgroundImageLight: null,
    backgroundOverlayOpacity: 20,
    backgroundImageBlur: 0,
  },
});

/**
 * Task numbering is shared across profiles: 1–50 source, 51–100 focus, then
 * background. Long-list moves the first background tasks into focus, so the
 * first 50 focus tasks and the whole source project are identical everywhere.
 */
export const generateAccount = (profile: Profile): BenchmarkAccount => {
  const backgroundIds = [INBOX_PROJECT_ID];
  for (let i = 1; backgroundIds.length < profile.projects - 2; i++) {
    backgroundIds.push(`perf-p-bg-${String(i).padStart(3, '0')}`);
  }
  const membership = new Map<string, string[]>(
    [SOURCE_PROJECT_ID, FOCUS_PROJECT_ID, ...backgroundIds].map((id) => [id, []]),
  );
  const tasks: Task[] = [];
  for (let nr = 1; nr <= profile.totalTasks; nr++) {
    const bgIndex = nr - SOURCE_TASK_COUNT - profile.focusTasks - 1;
    const projectId =
      nr <= SOURCE_TASK_COUNT
        ? SOURCE_PROJECT_ID
        : bgIndex < 0
          ? FOCUS_PROJECT_ID
          : backgroundIds[bgIndex % backgroundIds.length];
    tasks.push(createTask(nr, projectId));
    membership.get(projectId)!.push(taskId(nr));
  }

  const projects = [...membership.entries()].map(([id, ids]) =>
    createProject(id, projectTitle(id), ids),
  );
  const account: BenchmarkAccount = {
    data: {
      task: {
        ids: tasks.map((t) => t.id),
        entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
        currentTaskId: null,
        selectedTaskId: null,
        lastCurrentTaskId: null,
        isDataLoaded: false,
      },
      project: {
        ids: projects.map((p) => p.id),
        entities: Object.fromEntries(projects.map((p) => [p.id, p])),
      },
      menuTree: {
        projectTree: projects
          .filter((p) => p.id !== INBOX_PROJECT_ID)
          .map((p) => ({ k: MenuTreeKind.PROJECT as const, id: p.id })),
        tagTree: [],
      },
    },
    focusTaskIds: membership.get(FOCUS_PROJECT_ID)!,
    sourceTaskIds: membership.get(SOURCE_PROJECT_ID)!,
  };
  assertAccount(profile, account);
  return account;
};

const projectTitle = (id: string): string =>
  id === INBOX_PROJECT_ID
    ? 'Inbox'
    : id === SOURCE_PROJECT_ID
      ? 'Benchmark source'
      : id === FOCUS_PROJECT_ID
        ? 'Benchmark focus'
        : `Benchmark ${id.slice('perf-p-'.length)}`;

/** Throws when the generated account does not match its profile. */
export const assertAccount = (profile: Profile, account: BenchmarkAccount): void => {
  const { task, project } = account.data;
  const fail = (msg: string): never => {
    throw new Error(`Dataset ${profile.name}: ${msg}`);
  };
  if (task.ids.length !== profile.totalTasks) fail(`task count ${task.ids.length}`);
  if (new Set(task.ids).size !== task.ids.length) fail('duplicate task ids');
  if (project.ids.length !== profile.projects)
    fail(`project count ${project.ids.length}`);
  if (account.focusTaskIds.length !== profile.focusTasks) fail('focus task count');
  if (account.sourceTaskIds.length !== SOURCE_TASK_COUNT) fail('source task count');
  const listed = project.ids.flatMap((id) => project.entities[id].taskIds);
  if (listed.length !== task.ids.length) fail('project membership does not cover tasks');
  for (const id of project.ids) {
    for (const tid of project.entities[id].taskIds) {
      if (task.entities[tid]?.projectId !== id) fail(`task ${tid} not in project ${id}`);
    }
  }
};
