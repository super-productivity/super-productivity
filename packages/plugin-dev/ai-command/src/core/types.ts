// Shared shapes of the AI Command core. Everything here is plain data, so the
// app, the unit tests and the eval run the same code.

/** The task fields the plugin reads. The app passes more at runtime than the plugin `Task` type declares. */
export interface TaskLike {
  id: string;
  title: string;
  isDone: boolean;
  notes?: string;
  timeEstimate: number;
  timeSpent: number;
  timeSpentOnDay?: Record<string, number>;
  projectId: string | null;
  tagIds: string[];
  parentId?: string | null;
  subTaskIds: string[];
  dueDay?: string | null;
  dueWithTime?: number | null;
  remindAt?: number | null;
  repeatCfgId?: string | null;
  deadlineDay?: string | null;
  deadlineWithTime?: number | null;
  priority?: number | string | null;
  created?: number;
}

export interface Named {
  id: string;
  title: string;
}

export interface Day {
  todayStr: string;
  startOfNextDayDiffMs: number;
  nowMs: number;
}

/** What one request may look at: the user's data at the moment of asking. */
export interface Snapshot {
  tasks: TaskLike[];
  projects: Named[];
  tags: Named[];
  day: Day;
  /** Ids of the selection on screen, the "these" of a follow-up. */
  selectionIds: string[];
  currentTaskId: string | null;
}

/** One task as sent to the model. Only facts the prompt names; never notes or ids. */
export interface SentTask {
  id: string;
  title: string;
  done?: true;
  when: 'today' | 'overdue' | 'later' | 'unplanned';
  due?: string;
  deadline?: string;
  estimateMin?: number;
  spentMin?: number;
  priority?: string;
  repeats?: true;
  fixedTime?: true;
  parent?: string;
  project?: string;
  tags?: string[];
  selected?: true;
}

export interface ModelContext {
  day: { today: string; weekday: string; tomorrow: string; freeMinutesToday: number };
  projects: string[];
  tags: string[];
  tasks: SentTask[];
}

/** The model context plus what is needed to map its answer back, kept on the device. */
export interface Context {
  sent: ModelContext;
  aliasToId: Map<string, string>;
  idToAlias: Map<string, string>;
  /** Tasks the user's words matched (title, project or tag), for § 8.1. */
  matchedIds: Set<string>;
  snapshot: Snapshot;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

/** Field values compared on Apply to catch a task that changed since the proposal. */
export interface TaskStamp {
  title: string;
  isDone: boolean;
  timeEstimate: number;
  projectId: string | null;
  tagIds: string[];
  parentId: string | null;
  dueDay: string | null;
  dueWithTime: number | null;
  remindAt: number | null;
  deadline: string | null;
  repeatCfgId: string | null;
}

export interface AddRow {
  kind: 'add';
  key: string;
  ref: string;
  title: string;
  projectId?: string;
  tagIds?: string[];
  dueDay?: string;
  timeEstimate?: number;
  /** An existing parent task. */
  parentId?: string;
  /** The `ref` of a parent added in the same proposal. */
  parentRef?: string;
  note?: string;
}

export interface UpdateRow {
  kind: 'update';
  key: string;
  taskId: string;
  stamp: TaskStamp;
  title?: string;
  /** `null` unplans. */
  dueDay?: string | null;
  timeEstimate?: number;
  isDone?: boolean;
  projectId?: string;
  tagIds?: string[];
  appendNote?: string;
}

export interface DeleteRow {
  kind: 'delete';
  key: string;
  taskId: string;
  stamp: TaskStamp;
}

export type ChangeRow = AddRow | UpdateRow | DeleteRow;

export interface SelectionItem {
  taskId: string;
  reason: string;
}

export interface Proposal {
  changes: ChangeRow[];
  selection: { title: string; items: SelectionItem[] } | null;
  say: string | null;
  /** Plain notes on rows the validator dropped. */
  dropped: string[];
  /** More than the change cap; nothing else is shown. */
  isTooMany: boolean;
  /** Every change only sets a day: shown as a day plan. */
  isDayPlan: boolean;
}

export interface AppliedRow {
  key: string;
  taskId: string | null;
  title: string;
  /** Old → new, one entry per changed field ("Today → Tomorrow", "Marked done"). */
  what: string[];
  error?: string;
}
