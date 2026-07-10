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
  sync_token?: string;
  full_sync?: boolean;
  full_sync_date_utc?: string;
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

// Everything below lands in synced state that every client must replay —
// clamp remote-controlled sizes and reject nonsense dates instead of
// trusting the payload (shared-project collaborators control much of it).
const MAX_TITLE_LEN = 1000;
const MAX_LABEL_LEN = 200;
const MAX_NOTES_LEN = 50_000;
const MIN_DUE_MS = 0; // 1970
const MAX_DUE_MS = 32_503_680_000_000; // year 3000

export interface ParseStrings {
  untitledProject: string;
  untitledTask: string;
  repeats: (rule: string) => string;
  deadline: (date: string) => string;
  comments: string;
  file: string;
}

const DEFAULT_PARSE_STRINGS: ParseStrings = {
  untitledProject: 'Untitled project',
  untitledTask: 'Untitled task',
  repeats: (rule) => `Repeats: ${rule}`,
  deadline: (date) => `Deadline: ${date}`,
  comments: 'Comments:',
  file: 'file',
};

const asId = (v: string | number | null | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

const mergeResources = <T extends { id?: string | number }>(
  full: T[] | undefined,
  incremental: T[] | undefined,
): T[] | undefined => {
  if (!incremental?.length) {
    return full;
  }
  const changedIds = new Set(
    incremental.map((resource) => asId(resource.id)).filter((id): id is string => !!id),
  );
  return [
    ...incremental,
    ...(full || []).filter((resource) => {
      const id = asId(resource.id);
      return !id || !changedIds.has(id);
    }),
  ];
};

/**
 * Apply the delta returned by a Todoist incremental sync to its initial full
 * snapshot. Incremental tombstones intentionally replace the old resource so
 * the normal parser filters deletions instead of resurrecting stale data.
 */
export const mergeSyncResponses = (
  full: RawSyncResponse,
  incremental: RawSyncResponse,
): RawSyncResponse => ({
  ...full,
  ...incremental,
  projects: mergeResources(full.projects, incremental.projects),
  items: mergeResources(full.items, incremental.items),
  sections: mergeResources(full.sections, incremental.sections),
  notes: mergeResources(full.notes, incremental.notes),
});

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

const isSupportedAttachmentUrl = (url: unknown): url is string => {
  if (typeof url !== 'string' || /[\s\u0000-\u001f\u007f]/u.test(url)) {
    return false;
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const isTruthyFlag = (v: boolean | number | undefined): boolean => !!v;

const clamp = (s: string, maxLen: number): string =>
  s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;

/** Shape AND calendar validity (rejects e.g. 2026-99-99). */
const isValidDayStr = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE_ONLY_RE.test(s)) {
    return false;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * `new Date('YYYY-MM-DDTHH:MM:SS')` is local time per spec; a trailing `Z`
 * makes it a UTC instant — exactly Todoist's floating vs fixed semantics.
 */
const parseDue = (
  due: RawDue | null | undefined,
): { dueDay: string | null; dueWithTime: number | null } => {
  const date = due?.date;
  if (!date || typeof date !== 'string') {
    return { dueDay: null, dueWithTime: null };
  }
  if (DATE_ONLY_RE.test(date)) {
    return isValidDayStr(date)
      ? { dueDay: date, dueWithTime: null }
      : { dueDay: null, dueWithTime: null };
  }
  const ts = new Date(date).getTime();
  return Number.isNaN(ts) || ts < MIN_DUE_MS || ts > MAX_DUE_MS
    ? { dueDay: null, dueWithTime: null }
    : { dueDay: null, dueWithTime: ts };
};

const buildNotes = (
  item: RawItem,
  comments: RawNote[],
  deadlineNoted: string | null,
  strings: ParseStrings,
): { notes: string; truncatedFieldCount: number } => {
  const parts: string[] = [];
  const description = asStr(item.description).trim();
  if (description) {
    parts.push(description);
  }
  const extras: string[] = [];
  if (item.due?.is_recurring && asStr(item.due.string)) {
    extras.push(strings.repeats(asStr(item.due.string)));
  }
  if (deadlineNoted) {
    extras.push(strings.deadline(deadlineNoted));
  }
  if (extras.length) {
    parts.push(extras.join('\n'));
  }
  if (comments.length) {
    const lines = comments.map((c) => {
      const content = asStr(c.content).trim();
      const att = c.file_attachment;
      // scheme-filter remote URLs before they land in markdown-rendered notes
      const url = asStr(att?.file_url);
      const attLine = isSupportedAttachmentUrl(url)
        ? ` ${asStr(att?.file_name) || strings.file}: ${url}`
        : '';
      return `- ${content}${attLine}`.trimEnd();
    });
    parts.push(`${strings.comments}\n${lines.join('\n')}`);
  }
  const notes = parts.join('\n\n');
  return {
    notes: clamp(notes, MAX_NOTES_LEN),
    truncatedFieldCount: notes.length > MAX_NOTES_LEN ? 1 : 0,
  };
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
export const parseSyncResponse = (
  raw: RawSyncResponse,
  strings: ParseStrings = DEFAULT_PARSE_STRINGS,
): TodoistImportModel => {
  const projects: TodoistProject[] = [];
  const keptProjectIds = new Set<string>();

  for (const p of raw.projects || []) {
    const extId = asId(p.id);
    if (!extId || isTruthyFlag(p.is_archived) || isTruthyFlag(p.is_deleted)) {
      continue;
    }
    const title = asStr(p.name).trim();
    keptProjectIds.add(extId);
    projects.push({
      extId,
      title: clamp(title, MAX_TITLE_LEN) || strings.untitledProject,
      parentExtId: asId(p.parent_id),
      isInbox: !!p.inbox_project,
      childOrder: p.child_order ?? 0,
      truncatedFieldCount: title.length > MAX_TITLE_LEN ? 1 : 0,
    });
  }
  // parent-first DFS: `child_order` is per-parent in Todoist, so a flat sort
  // would interleave unrelated siblings; this keeps children next to their
  // (flattened-away) parent in the SP sidebar
  const orderedProjects: TodoistProject[] = [];
  const projectChildren = new Map<string | null, TodoistProject[]>();
  for (const p of projects) {
    const parentKey =
      p.parentExtId && keptProjectIds.has(p.parentExtId) ? p.parentExtId : null;
    const list = projectChildren.get(parentKey) || [];
    list.push(p);
    projectChildren.set(parentKey, list);
  }
  projectChildren.forEach((list) => list.sort((a, b) => a.childOrder - b.childOrder));
  const visitedProjects = new Set<string>();
  const visitProject = (p: TodoistProject): void => {
    if (visitedProjects.has(p.extId)) {
      return;
    }
    visitedProjects.add(p.extId);
    orderedProjects.push(p);
    (projectChildren.get(p.extId) || []).forEach(visitProject);
  };
  (projectChildren.get(null) || []).forEach(visitProject);
  // a parent-cycle in a hostile payload would skip its members entirely —
  // append anything unvisited so no project is silently lost
  for (const p of projects) {
    visitProject(p);
  }

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
    sections.push({ extId, projectExtId, title: asStr(s.name).trim() });
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

  // parent missing (completed/deleted/filtered) OR in another project (a
  // shape Todoist shouldn't produce — its temp ID could never resolve in this
  // project's batch) → treat as root
  const projectByItemId = new Map<string, string>(
    keptItems.map((i) => [asId(i.id) as string, asId(i.project_id) as string]),
  );
  const childrenByParent = new Map<string, RawItem[]>();
  const roots: RawItem[] = [];
  for (const item of keptItems) {
    const parentId = asId(item.parent_id);
    if (
      parentId &&
      keptItemIds.has(parentId) &&
      projectByItemId.get(parentId) === asId(item.project_id)
    ) {
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

  const projectOrder = new Map(orderedProjects.map((p, i) => [p.extId, i]));
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
    const deadlineDay = isValidDayStr(item.deadline?.date) ? item.deadline!.date! : null;
    const hasDue = !!parsedDueDay || !!dueWithTime;
    // deadline fills in as dueDay when there is no due date; otherwise it is
    // preserved as a notes line so nothing is silently dropped
    const dueDay = parsedDueDay ?? (!hasDue ? deadlineDay : null);
    const deadlineNoted = hasDue && deadlineDay ? deadlineDay : null;

    const duration = item.duration;
    // Number.isFinite guards a hostile `1e999` → Infinity, which would diverge
    // across clients (Infinity JSON-serializes to null in the op-log)
    const isMinuteDuration =
      !!duration &&
      duration.unit === 'minute' &&
      Number.isFinite(duration.amount) &&
      (duration.amount as number) > 0 &&
      (duration.amount as number) <= 525_600; // 1 year in minutes
    const isDayDurationSkipped = !!duration && duration.unit === 'day';

    const title = asStr(item.content).trim();
    const labels = (item.labels || []).filter(
      (label): label is string => typeof label === 'string' && label.trim() !== '',
    );
    const builtNotes = buildNotes(
      item,
      commentsByItemId.get(extId) || [],
      deadlineNoted,
      strings,
    );

    return {
      extId,
      projectExtId: asId(item.project_id) as string,
      parentExtId: rootExtId,
      title: clamp(title, MAX_TITLE_LEN) || strings.untitledTask,
      notes: builtNotes.notes,
      labels: labels.map((label) => clamp(label, MAX_LABEL_LEN)),
      apiPriority: item.priority ?? 1,
      dueDay,
      dueWithTime,
      timeEstimate: isMinuteDuration ? (duration.amount as number) * 60_000 : null,
      isRecurring: !!item.due?.is_recurring,
      wasDemoted: depth >= 2,
      isDayDurationSkipped,
      hasAssignee: !!asId(item.responsible_uid),
      attachmentCount: (commentsByItemId.get(extId) || []).filter((c) =>
        isSupportedAttachmentUrl(c.file_attachment?.file_url),
      ).length,
      truncatedFieldCount:
        (title.length > MAX_TITLE_LEN ? 1 : 0) +
        labels.filter((label) => label.length > MAX_LABEL_LEN).length +
        builtNotes.truncatedFieldCount,
    };
  };

  const tasks: TodoistTask[] = [];
  const emittedIds = new Set<string>();
  const emitFamily = (root: RawItem): void => {
    const rootExtId = asId(root.id) as string;
    emittedIds.add(rootExtId);
    tasks.push(toTask(root, null, 0));
    // all descendants become direct sub-tasks of the root, DFS keeps reading order
    const stack = (childrenByParent.get(rootExtId) || [])
      .map((item) => ({ item, depth: 1 }))
      .reverse();
    while (stack.length) {
      const { item, depth } = stack.pop() as { item: RawItem; depth: number };
      const itemId = asId(item.id) as string;
      if (emittedIds.has(itemId)) {
        continue; // parent-cycle guard in a hostile payload
      }
      emittedIds.add(itemId);
      tasks.push(toTask(item, rootExtId, depth));
      const children = childrenByParent.get(itemId) || [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ item: children[i], depth: depth + 1 });
      }
    }
  };
  roots.forEach(emitFamily);
  // members of a parent-cycle have no root — emit them as roots so nothing
  // in the payload is silently dropped
  for (const item of keptItems) {
    if (!emittedIds.has(asId(item.id) as string)) {
      emitFamily(item);
    }
  }

  return { projects: orderedProjects, sections, tasks };
};
