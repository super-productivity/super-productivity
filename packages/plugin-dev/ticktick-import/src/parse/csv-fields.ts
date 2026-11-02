/**
 * Field-level parsers for TickTick's CSV backup. The format is undocumented;
 * the shapes below follow real exports as handled by other importers
 * (e.g. Vikunja's TickTick migrator):
 * - instants look like `2023-12-20T10:00:00+0000`,
 * - all-day dates are midnight in the task's `Timezone` column, stored as UTC,
 * - checklist items are `Content` lines prefixed `▫` (open) or `▪` (checked).
 */

const MIN_DUE_MS = 0; // 1970
const MAX_DUE_MS = 32_503_680_000_000; // year 3000

const INSTANT_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * `+0000` without a colon is not an ECMAScript date-time string, so normalize
 * the offset before `Date.parse`. A missing offset is read as UTC, which is
 * what TickTick writes.
 */
export const parseInstant = (value: string): number | null => {
  const match = INSTANT_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, day, time, rawOffset] = match;
  const offset =
    !rawOffset || rawOffset === 'Z'
      ? 'Z'
      : `${rawOffset.slice(0, 3)}:${rawOffset.slice(-2)}`;
  const ms = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}${offset}`);
  return Number.isNaN(ms) || ms < MIN_DUE_MS || ms > MAX_DUE_MS ? null : ms;
};

const dayInZone = (ms: number, timeZone: string | undefined): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/**
 * All-day tasks are stored as the UTC instant of local midnight, so the day
 * must be read in the task's own time zone — reading it in UTC would shift
 * every all-day task east of Greenwich to the previous day.
 */
export const toDueDay = (ms: number, timeZone: string): string => {
  if (timeZone) {
    try {
      return dayInZone(ms, timeZone);
    } catch {
      // unknown IANA zone (RangeError) — the device zone is the best guess left
    }
  }
  return dayInZone(ms, undefined);
};

const CHECK_OPEN = '▫';
const CHECK_DONE = '▪';

export interface ChecklistItem {
  title: string;
  isDone: boolean;
}

/** Splits checklist `Content` into its items and any free-text description. */
export const splitChecklist = (
  content: string,
): { items: ChecklistItem[]; description: string } => {
  const items: ChecklistItem[] = [];
  const descriptionLines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(CHECK_OPEN) || trimmed.startsWith(CHECK_DONE)) {
      const title = trimmed.slice(1).trim();
      if (title) {
        items.push({ title, isDone: trimmed.startsWith(CHECK_DONE) });
      }
    } else {
      descriptionLines.push(line);
    }
  }
  return { items, description: descriptionLines.join('\n').trim() };
};

/** Markdown checklist for items that cannot become sub-tasks (nesting limit). */
export const checklistToMarkdown = (items: ChecklistItem[]): string =>
  items.map((item) => `- [${item.isDone ? 'x' : ' '}] ${item.title}`).join('\n');

export const splitTags = (value: string): string[] => {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};
