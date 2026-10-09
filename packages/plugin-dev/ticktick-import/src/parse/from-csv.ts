import {
  checklistToMarkdown,
  ChecklistItem,
  parseInstant,
  splitChecklist,
  splitTags,
  toDueDay,
} from './csv-fields';
import { parseCsv } from './parse-csv';
import { TickTickImportModel, TickTickProject, TickTickTask } from './normalized-model';

// a backup file may come from anywhere — clamp sizes instead of trusting it
const MAX_TITLE_LEN = 1000;
const MAX_TAG_LEN = 200;
const MAX_NOTES_LEN = 50_000;

const OPEN_STATUS = '0';

export interface ParseStrings {
  untitledProject: string;
  untitledTask: string;
  repeats: (rule: string) => string;
}

const DEFAULT_PARSE_STRINGS: ParseStrings = {
  untitledProject: 'Untitled project',
  untitledTask: 'Untitled task',
  repeats: (rule) => `Repeats: ${rule}`,
};

type Row = (column: string) => string;

interface RawTask {
  extId: string;
  parentExtId: string;
  projectExtId: string;
  order: number;
  row: Row;
}

const clamp = (s: string, maxLen: number): { value: string; isCut: boolean } =>
  s.length > maxLen
    ? { value: `${s.slice(0, maxLen)}…`, isCut: true }
    : { value: s, isCut: false };

/**
 * TickTick writes a few `Date:` / `Version:` / `Status:` lines (the last one
 * with an embedded multi-line legend) before the header, and their number has
 * changed between versions — so locate the header row instead of skipping a
 * fixed count.
 */
const findHeader = (rows: string[][]): number =>
  rows.findIndex((r) => r.includes('List Name') && r.includes('Title'));

const parseDue = (row: Row): { dueDay: string | null; dueWithTime: number | null } => {
  const ms = parseInstant(row('Due Date')) ?? parseInstant(row('Start Date'));
  if (ms === null) {
    return { dueDay: null, dueWithTime: null };
  }
  return row('Is All Day').toLowerCase() === 'true'
    ? { dueDay: toDueDay(ms, row('Timezone')), dueWithTime: null }
    : { dueDay: null, dueWithTime: ms };
};

/**
 * Root ancestor among the open tasks of the same project — a closed, missing or
 * foreign-project parent ends the walk. `null` when the chain loops, so the
 * caller can import the task as a root instead of dropping it.
 */
const findRoot = (task: RawTask, byExtId: Map<string, RawTask>): RawTask | null => {
  const seen = new Set<string>([task.extId]);
  let current = task;
  let parent = byExtId.get(current.parentExtId);
  while (parent && parent.projectExtId === task.projectExtId) {
    if (seen.has(parent.extId)) {
      return null;
    }
    seen.add(parent.extId);
    current = parent;
    parent = byExtId.get(current.parentExtId);
  }
  return current;
};

const toProject = (row: Row, extId: string, strings: ParseStrings): TickTickProject => {
  const listName = row('List Name').trim();
  const title = clamp(listName, MAX_TITLE_LEN);
  const folder = clamp(row('Folder Name').trim(), MAX_TITLE_LEN);
  return {
    extId,
    title: title.value || strings.untitledProject,
    folderTitle: folder.value,
    isInbox: !folder.value && listName.toLowerCase() === 'inbox',
    columnCount: 0,
    truncatedFieldCount: Number(title.isCut) + Number(folder.isCut),
  };
};

const buildNotes = (parts: string[]): { notes: string; isCut: boolean } => {
  const { value, isCut } = clamp(parts.filter(Boolean).join('\n\n'), MAX_NOTES_LEN);
  return { notes: value, isCut };
};

/**
 * CSV backup text → normalized model, or `null` when the text is not a
 * TickTick backup. Pure; safe to unit-test with fixtures.
 *
 * - only open tasks (Status 0) are imported; completed, archived and
 *   won't-do rows are counted and skipped,
 * - the task tree is flattened to SP's 2 levels: deeper tasks are
 *   re-parented to their root ancestor; a task whose parent is not imported
 *   becomes a root,
 * - checklist items become sub-tasks of root tasks; on sub-tasks (which
 *   cannot have children in SP) they stay as a markdown checklist in notes.
 */
export const parseTickTickCsv = (
  text: string,
  strings: ParseStrings = DEFAULT_PARSE_STRINGS,
): TickTickImportModel | null => {
  const rows = parseCsv(text);
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) {
    return null;
  }
  const header = rows[headerIndex];
  const col = new Map(header.map((name, i) => [name.trim(), i]));

  const projects = new Map<string, TickTickProject>();
  const rawTasks: RawTask[] = [];
  const columnsByProject = new Map<string, Set<string>>();
  const seenTaskIds = new Set<string>();
  let skippedClosedCount = 0;

  rows.slice(headerIndex + 1).forEach((cells, i) => {
    const row: Row = (name) => cells[col.get(name) ?? -1] ?? '';
    if ((row('Status').trim() || OPEN_STATUS) !== OPEN_STATUS) {
      skippedClosedCount++;
      return;
    }
    const projectExtId = `${row('Folder Name').trim()}\u0000${row('List Name').trim()}`;
    if (!projects.has(projectExtId)) {
      projects.set(projectExtId, toProject(row, projectExtId, strings));
    }
    if (row('Column Name').trim()) {
      const columns = columnsByProject.get(projectExtId) || new Set<string>();
      columns.add(row('Column Name').trim());
      columnsByProject.set(projectExtId, columns);
    }
    const order = Number.parseFloat(row('Order'));
    const taskId = row('taskId').trim();
    // older exports have no taskId column — fall back to the row position;
    // a duplicate id would collide as a batch temp ID
    const extId = taskId && !seenTaskIds.has(taskId) ? taskId : `row-${i}`;
    seenTaskIds.add(extId);
    rawTasks.push({
      extId,
      parentExtId: row('parentId').trim(),
      projectExtId,
      order: Number.isFinite(order) ? order : 0,
      row,
    });
  });

  return {
    projects: [...projects.values()].map((p) => ({
      ...p,
      columnCount: columnsByProject.get(p.extId)?.size || 0,
    })),
    tasks: emitTasks(rawTasks, strings),
    skippedClosedCount,
  };
};

const toTask = (
  raw: RawTask,
  parentExtId: string | null,
  wasDemoted: boolean,
  strings: ParseStrings,
): { task: TickTickTask; checklist: ChecklistItem[] } => {
  const { row } = raw;
  const isChecklist = row('Is Check list').trim().toUpperCase() === 'Y';
  const content = row('Content');
  const { items, description } = isChecklist
    ? splitChecklist(content)
    : { items: [], description: content.trim() };
  const repeat = row('Repeat').trim();
  // sub-tasks cannot have children in SP — keep their checklist readable in notes
  const nestedChecklist = parentExtId && items.length ? checklistToMarkdown(items) : '';
  const { notes, isCut: isNotesCut } = buildNotes([
    description,
    nestedChecklist,
    repeat ? strings.repeats(repeat) : '',
  ]);
  const title = clamp(row('Title').trim(), MAX_TITLE_LEN);
  const rawTags = splitTags(row('Tags'));
  const priority = Number.parseInt(row('Priority'), 10);
  return {
    task: {
      extId: raw.extId,
      projectExtId: raw.projectExtId,
      parentExtId,
      title: title.value || strings.untitledTask,
      notes,
      isDone: false,
      tags: rawTags.map((tag) => clamp(tag, MAX_TAG_LEN).value),
      priority: Number.isFinite(priority) ? priority : 0,
      ...parseDue(row),
      isRecurring: !!repeat,
      hasReminder: !!row('Reminder').trim(),
      wasDemoted,
      truncatedFieldCount:
        Number(title.isCut) +
        Number(isNotesCut) +
        rawTags.filter((tag) => tag.length > MAX_TAG_LEN).length,
    },
    checklist: parentExtId ? [] : items,
  };
};

const checklistTasks = (
  root: TickTickTask,
  items: ChecklistItem[],
  strings: ParseStrings,
): TickTickTask[] =>
  items.map((item, i) => {
    const title = clamp(item.title, MAX_TITLE_LEN);
    return {
      extId: `${root.extId}#check-${i}`,
      projectExtId: root.projectExtId,
      parentExtId: root.extId,
      title: title.value || strings.untitledTask,
      notes: '',
      isDone: item.isDone,
      tags: [],
      priority: 0,
      dueDay: null,
      dueWithTime: null,
      isRecurring: false,
      hasReminder: false,
      wasDemoted: false,
      truncatedFieldCount: Number(title.isCut),
    };
  });

/**
 * Orders tasks for creation: per project, roots by TickTick `Order`, each
 * followed by its checklist items and then its descendants in DFS order — a
 * parent always precedes its children, which keeps batch chunking safe.
 */
const emitTasks = (rawTasks: RawTask[], strings: ParseStrings): TickTickTask[] => {
  const byExtId = new Map(rawTasks.map((t) => [t.extId, t]));
  const byOrder = (a: RawTask, b: RawTask): number => a.order - b.order;
  const childrenByParent = new Map<string, RawTask[]>();
  const roots: RawTask[] = [];
  for (const raw of rawTasks) {
    const root = findRoot(raw, byExtId);
    if (!root || root === raw) {
      roots.push(raw);
      continue;
    }
    // an acyclic chain to a root means the direct parent is imported as well
    const siblings = childrenByParent.get(raw.parentExtId) || [];
    siblings.push(raw);
    childrenByParent.set(raw.parentExtId, siblings);
  }

  const projectOrder = [...new Set(rawTasks.map((t) => t.projectExtId))];
  const tasks: TickTickTask[] = [];
  for (const projectExtId of projectOrder) {
    const projectRoots = roots.filter((r) => r.projectExtId === projectExtId);
    for (const root of projectRoots.sort(byOrder)) {
      const { task, checklist } = toTask(root, null, false, strings);
      tasks.push(task, ...checklistTasks(task, checklist, strings));
      const visited = new Set<string>([root.extId]);
      const stack = [...(childrenByParent.get(root.extId) || [])].sort(byOrder).reverse();
      while (stack.length) {
        const raw = stack.pop() as RawTask;
        if (visited.has(raw.extId)) {
          continue;
        }
        visited.add(raw.extId);
        tasks.push(toTask(raw, root.extId, raw.parentExtId !== root.extId, strings).task);
        const children = [...(childrenByParent.get(raw.extId) || [])].sort(byOrder);
        stack.push(...children.reverse());
      }
    }
  }
  return tasks;
};
