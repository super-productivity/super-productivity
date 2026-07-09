import {
  TodoistImportModel,
  TodoistProject,
  TodoistSection,
  TodoistTask,
} from './normalized-model';

/**
 * Raw shapes from `POST https://api.todoist.com/api/v1/sync` (unified v1).
 * Only the fields we read; everything is optional so unknown/missing fields
 * from API drift degrade gracefully instead of crashing the import.
 */
export interface RawSyncResponse {
  projects?: RawProject[];
  items?: RawItem[];
  sections?: RawSection[];
  notes?: RawNote[];
}

interface RawProject {
  id?: string | number;
  name?: string;
  parent_id?: string | number | null;
  child_order?: number;
  inbox_project?: boolean;
  is_archived?: boolean | number;
  is_deleted?: boolean | number;
}

interface RawSection {
  id?: string | number;
  project_id?: string | number;
  name?: string;
  section_order?: number;
  is_deleted?: boolean | number;
  is_archived?: boolean | number;
}

interface RawDue {
  /** YYYY-MM-DD | YYYY-MM-DDTHH:MM:SS (floating/local) | …Z (fixed, UTC instant) */
  date?: string;
  timezone?: string | null;
  is_recurring?: boolean;
  string?: string;
}

interface RawItem {
  id?: string | number;
  project_id?: string | number;
  section_id?: string | number | null;
  parent_id?: string | number | null;
  content?: string;
  description?: string;
  /** 4 = UI p1 (highest) … 1 = default */
  priority?: number;
  labels?: string[];
  due?: RawDue | null;
  deadline?: { date?: string } | null;
  duration?: { amount?: number; unit?: string } | null;
  checked?: boolean | number;
  is_deleted?: boolean | number;
  child_order?: number;
  responsible_uid?: string | number | null;
}

interface RawNote {
  id?: string | number;
  item_id?: string | number;
  content?: string;
  is_deleted?: boolean | number;
  file_attachment?: { file_name?: string; file_url?: string } | null;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const asId = (v: string | number | null | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

const isTruthyFlag = (v: boolean | number | undefined): boolean => !!v;

/**
 * `new Date('YYYY-MM-DDTHH:MM:SS')` is local time per spec; a trailing `Z`
 * makes it a UTC instant — exactly Todoist's floating vs fixed semantics.
 */
const parseDue = (
  due: RawDue | null | undefined,
): { dueDay: string | null; dueWithTime: number | null } => {
  const date = due?.date;
  if (!date) {
    return { dueDay: null, dueWithTime: null };
  }
  if (DATE_ONLY_RE.test(date)) {
    return { dueDay: date, dueWithTime: null };
  }
  const ts = new Date(date).getTime();
  return Number.isNaN(ts)
    ? { dueDay: null, dueWithTime: null }
    : { dueDay: null, dueWithTime: ts };
};

const buildNotes = (
  item: RawItem,
  comments: RawNote[],
  deadlineNoted: string | null,
): string => {
  const parts: string[] = [];
  const description = (item.description || '').trim();
  if (description) {
    parts.push(description);
  }
  const extras: string[] = [];
  if (item.due?.is_recurring && item.due.string) {
    extras.push(`Repeats: ${item.due.string}`);
  }
  if (deadlineNoted) {
    extras.push(`Deadline: ${deadlineNoted}`);
  }
  if (extras.length) {
    parts.push(extras.join('\n'));
  }
  if (comments.length) {
    const lines = comments.map((c) => {
      const content = (c.content || '').trim();
      const att = c.file_attachment;
      const attLine = att?.file_url ? ` ${att.file_name || 'file'}: ${att.file_url}` : '';
      return `- ${content}${attLine}`.trimEnd();
    });
    parts.push(`Comments:\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
};

/**
 * Sync payload → normalized model. Pure; safe to unit-test with fixtures.
 *
 * - completed (`checked`) and deleted items are skipped, as are archived /
 *   deleted projects (and their items),
 * - the item tree is flattened to SP's 2 levels: any task deeper than one
 *   level is re-parented to its root ancestor in DFS (reading) order,
 * - items whose parent is missing (completed/deleted) are treated as roots.
 */
export const parseSyncResponse = (raw: RawSyncResponse): TodoistImportModel => {
  const projects: TodoistProject[] = [];
  const keptProjectIds = new Set<string>();

  for (const p of raw.projects || []) {
    const extId = asId(p.id);
    if (!extId || isTruthyFlag(p.is_archived) || isTruthyFlag(p.is_deleted)) {
      continue;
    }
    keptProjectIds.add(extId);
    projects.push({
      extId,
      title: (p.name || '').trim() || 'Untitled project',
      parentExtId: asId(p.parent_id),
      isInbox: !!p.inbox_project,
      childOrder: p.child_order ?? 0,
    });
  }
  projects.sort((a, b) => a.childOrder - b.childOrder);

  const sections: TodoistSection[] = [];
  const sectionOrderById = new Map<string, number>();
  for (const s of raw.sections || []) {
    const extId = asId(s.id);
    const projectExtId = asId(s.project_id);
    if (
      !extId ||
      !projectExtId ||
      !keptProjectIds.has(projectExtId) ||
      isTruthyFlag(s.is_deleted) ||
      isTruthyFlag(s.is_archived)
    ) {
      continue;
    }
    sectionOrderById.set(extId, s.section_order ?? 0);
    sections.push({ extId, projectExtId, title: (s.name || '').trim() });
  }

  const commentsByItemId = new Map<string, RawNote[]>();
  for (const n of raw.notes || []) {
    const itemId = asId(n.item_id);
    if (!itemId || isTruthyFlag(n.is_deleted)) {
      continue;
    }
    const list = commentsByItemId.get(itemId) || [];
    list.push(n);
    commentsByItemId.set(itemId, list);
  }

  const keptItems: RawItem[] = [];
  const keptItemIds = new Set<string>();
  for (const item of raw.items || []) {
    const extId = asId(item.id);
    const projectExtId = asId(item.project_id);
    if (
      !extId ||
      !projectExtId ||
      !keptProjectIds.has(projectExtId) ||
      isTruthyFlag(item.checked) ||
      isTruthyFlag(item.is_deleted)
    ) {
      continue;
    }
    keptItems.push(item);
    keptItemIds.add(extId);
  }

  // parent missing (completed/deleted/filtered) → treat as root
  const childrenByParent = new Map<string, RawItem[]>();
  const roots: RawItem[] = [];
  for (const item of keptItems) {
    const parentId = asId(item.parent_id);
    if (parentId && keptItemIds.has(parentId)) {
      const list = childrenByParent.get(parentId) || [];
      list.push(item);
      childrenByParent.set(parentId, list);
    } else {
      roots.push(item);
    }
  }
  childrenByParent.forEach((list) =>
    list.sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0)),
  );

  const projectOrder = new Map(projects.map((p, i) => [p.extId, i]));
  const rootSortKey = (item: RawItem): [number, number, number] => {
    const sectionId = asId(item.section_id);
    // section-less tasks come first in Todoist, like sections with order -1
    const sectionOrder = sectionId ? (sectionOrderById.get(sectionId) ?? 0) : -1;
    return [
      projectOrder.get(asId(item.project_id) as string) ?? 0,
      sectionOrder,
      item.child_order ?? 0,
    ];
  };
  roots.sort((a, b) => {
    const [pa, sa, ca] = rootSortKey(a);
    const [pb, sb, cb] = rootSortKey(b);
    return pa - pb || sa - sb || ca - cb;
  });

  const toTask = (
    item: RawItem,
    rootExtId: string | null,
    depth: number,
  ): TodoistTask => {
    const extId = asId(item.id) as string;
    const { dueDay: parsedDueDay, dueWithTime } = parseDue(item.due);
    const deadlineDay =
      item.deadline?.date && DATE_ONLY_RE.test(item.deadline.date)
        ? item.deadline.date
        : null;
    const hasDue = !!parsedDueDay || !!dueWithTime;
    // deadline fills in as dueDay when there is no due date; otherwise it is
    // preserved as a notes line so nothing is silently dropped
    const dueDay = parsedDueDay ?? (!hasDue ? deadlineDay : null);
    const deadlineNoted = hasDue && deadlineDay ? deadlineDay : null;

    const duration = item.duration;
    const isMinuteDuration =
      !!duration && duration.unit === 'minute' && (duration.amount ?? 0) > 0;
    const isDayDurationSkipped = !!duration && duration.unit === 'day';

    return {
      extId,
      projectExtId: asId(item.project_id) as string,
      parentExtId: rootExtId,
      title: (item.content || '').trim() || 'Untitled task',
      notes: buildNotes(item, commentsByItemId.get(extId) || [], deadlineNoted),
      labels: (item.labels || []).filter((l) => typeof l === 'string' && l.trim() !== ''),
      apiPriority: item.priority ?? 1,
      dueDay,
      dueWithTime,
      timeEstimate: isMinuteDuration ? (duration.amount as number) * 60_000 : null,
      isRecurring: !!item.due?.is_recurring,
      wasDemoted: depth >= 2,
      isDayDurationSkipped,
      hasAssignee: !!asId(item.responsible_uid),
      attachmentCount: (commentsByItemId.get(extId) || []).filter(
        (c) => !!c.file_attachment?.file_url,
      ).length,
    };
  };

  const tasks: TodoistTask[] = [];
  for (const root of roots) {
    const rootExtId = asId(root.id) as string;
    tasks.push(toTask(root, null, 0));
    // all descendants become direct sub-tasks of the root, DFS keeps reading order
    const stack = [...(childrenByParent.get(rootExtId) || [])].reverse();
    const depthById = new Map<string, number>(
      (childrenByParent.get(rootExtId) || []).map((c) => [asId(c.id) as string, 1]),
    );
    while (stack.length) {
      const item = stack.pop() as RawItem;
      const itemId = asId(item.id) as string;
      const depth = depthById.get(itemId) ?? 1;
      tasks.push(toTask(item, rootExtId, depth));
      const children = childrenByParent.get(itemId) || [];
      for (let i = children.length - 1; i >= 0; i--) {
        const childId = asId(children[i].id) as string;
        depthById.set(childId, depth + 1);
        stack.push(children[i]);
      }
    }
  }

  return { projects, sections, tasks };
};
