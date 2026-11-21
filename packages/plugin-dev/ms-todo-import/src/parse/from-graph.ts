import { MsTodoImportModel, MsTodoList, MsTodoTask } from './normalized-model';
import { describeRecurrence, mapRecurrence, RawRecurrence } from './map-recurrence';

/** Microsoft Graph `todoTaskList` (fields used). */
export interface RawList {
  id?: string;
  displayName?: string;
  wellknownListName?: string;
}

interface RawChecklistItem {
  id?: string;
  displayName?: string;
  isChecked?: boolean;
}

/** Microsoft Graph `todoTask` (fields used). */
export interface RawTask {
  id?: string;
  title?: string;
  status?: string;
  importance?: string;
  body?: { content?: string; contentType?: string } | null;
  dueDateTime?: { dateTime?: string; timeZone?: string } | null;
  recurrence?: RawRecurrence | null;
  categories?: string[];
  checklistItems?: RawChecklistItem[];
  isReminderOn?: boolean;
  hasAttachments?: boolean;
}

export interface RawGraphData {
  lists: RawList[];
  tasksByListId: Record<string, RawTask[]>;
}

// Everything below lands in synced state that every client must replay —
// clamp remote-controlled sizes and reject nonsense dates instead of
// trusting the payload (shared-list members control much of it).
const MAX_TITLE_LEN = 1000;
const MAX_CATEGORY_LEN = 200;
const MAX_NOTES_LEN = 50_000;

export interface ParseStrings {
  untitledList: string;
  untitledTask: string;
  repeats: (rule: string) => string;
}

const DEFAULT_PARSE_STRINGS: ParseStrings = {
  untitledList: 'Untitled list',
  untitledTask: 'Untitled task',
  repeats: (rule) => `Repeats: ${rule}`,
};

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

interface Clamped {
  value: string;
  truncated: number;
}

const clamp = (s: string, maxLen: number): Clamped =>
  s.length > maxLen
    ? { value: `${s.slice(0, maxLen)}…`, truncated: 1 }
    : { value: s, truncated: 0 };

const pad = (n: number): string => String(n).padStart(2, '0');

/** Shape AND calendar validity (rejects e.g. 2026-99-99). */
const isValidDayStr = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * To Do due dates are whole days. Graph returns them either as local midnight
 * in a named zone, or as that midnight converted to UTC (e.g. 23:00 the day
 * before for Berlin). A midnight value is the day itself; any other UTC
 * value is converted to the device's local day.
 */
export const parseDueDay = (due: RawTask['dueDateTime']): string | null => {
  const dateTime = asStr(due?.dateTime);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dateTime);
  if (!match || !isValidDayStr(match[1])) {
    return null;
  }
  const isMidnight = match[2] === '00' && match[3] === '00';
  if (isMidnight || asStr(due?.timeZone).toUpperCase() !== 'UTC') {
    return match[1];
  }
  const local = new Date(`${match[1]}T${match[2]}:${match[3]}:00Z`);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
};

/** To Do notes are usually plain text; HTML bodies are reduced to their text. */
const bodyToText = (body: RawTask['body']): string => {
  const content = asStr(body?.content);
  if (asStr(body?.contentType).toLowerCase() !== 'html') {
    return content.trim();
  }
  const withBreaks = content.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
};

const parseList = (raw: RawList, strings: ParseStrings): MsTodoList => {
  const title = clamp(
    asStr(raw.displayName).trim() || strings.untitledList,
    MAX_TITLE_LEN,
  );
  return {
    extId: asStr(raw.id),
    title: title.value,
    isDefault: raw.wellknownListName === 'defaultList',
    isFlaggedEmails: raw.wellknownListName === 'flaggedEmails',
    ...(title.truncated ? { truncatedFieldCount: title.truncated } : {}),
  };
};

const parseRepeat = (
  raw: RawTask,
  dueDay: string | null,
  description: string,
  strings: ParseStrings,
): { repeat: MsTodoTask['repeat']; ruleNote: string | null } => {
  if (!raw.recurrence) {
    return { repeat: null, ruleNote: null };
  }
  const ruleNote = strings.repeats(describeRecurrence(raw.recurrence));
  const schedule = dueDay ? mapRecurrence(raw.recurrence, dueDay) : null;
  if (!schedule) {
    return { repeat: null, ruleNote };
  }
  const notesWithRule = clamp(
    [description, ruleNote].filter(Boolean).join('\n\n'),
    MAX_NOTES_LEN,
  ).value;
  return { repeat: { schedule, notesWithRule }, ruleNote: null };
};

const parseTask = (raw: RawTask, listId: string, strings: ParseStrings): MsTodoTask => {
  const title = clamp(asStr(raw.title).trim() || strings.untitledTask, MAX_TITLE_LEN);
  const dueDay = parseDueDay(raw.dueDateTime);
  const description = bodyToText(raw.body);
  const { repeat, ruleNote } = parseRepeat(raw, dueDay, description, strings);
  const notes = clamp(
    [description, ruleNote].filter(Boolean).join('\n\n'),
    MAX_NOTES_LEN,
  );
  const categories = (raw.categories ?? [])
    .map((c) => asStr(c).trim())
    .filter(Boolean)
    .map((c) => clamp(c, MAX_CATEGORY_LEN));
  const truncated =
    title.truncated + notes.truncated + categories.reduce((n, c) => n + c.truncated, 0);
  return {
    extId: asStr(raw.id),
    projectExtId: listId,
    parentExtId: null,
    title: title.value,
    notes: notes.value,
    isDone: false,
    categories: categories.map((c) => c.value),
    isImportant: raw.importance === 'high',
    dueDay,
    isRecurring: !!raw.recurrence,
    repeat,
    hasReminder: !!raw.isReminderOn,
    hasAttachments: !!raw.hasAttachments,
    ...(truncated ? { truncatedFieldCount: truncated } : {}),
  };
};

const parseStep = (
  raw: RawChecklistItem,
  parent: MsTodoTask,
  strings: ParseStrings,
): MsTodoTask => {
  const title = clamp(
    asStr(raw.displayName).trim() || strings.untitledTask,
    MAX_TITLE_LEN,
  );
  return {
    extId: `${parent.extId}-step-${asStr(raw.id)}`,
    projectExtId: parent.projectExtId,
    parentExtId: parent.extId,
    title: title.value,
    notes: '',
    isDone: !!raw.isChecked,
    categories: [],
    isImportant: false,
    dueDay: null,
    isRecurring: false,
    repeat: null,
    hasReminder: false,
    hasAttachments: false,
    ...(title.truncated ? { truncatedFieldCount: title.truncated } : {}),
  };
};

/**
 * Graph payload → normalized model. Pure; safe to unit-test with fixtures.
 *
 * - completed tasks are skipped (the request filters them too),
 * - steps become sub-tasks right after their task; checked steps stay done,
 * - lists without open tasks are kept, so the preview can show them as empty.
 */
export const parseGraphData = (
  raw: RawGraphData,
  strings: ParseStrings = DEFAULT_PARSE_STRINGS,
): MsTodoImportModel => {
  const projects = raw.lists.filter((l) => asStr(l.id)).map((l) => parseList(l, strings));
  const tasks: MsTodoTask[] = [];
  for (const project of projects) {
    for (const rawTask of raw.tasksByListId[project.extId] ?? []) {
      if (!asStr(rawTask.id) || rawTask.status === 'completed') {
        continue;
      }
      const task = parseTask(rawTask, project.extId, strings);
      tasks.push(task);
      for (const item of rawTask.checklistItems ?? []) {
        if (asStr(item.id)) {
          tasks.push(parseStep(item, task, strings));
        }
      }
    }
  }
  return { projects, tasks };
};
