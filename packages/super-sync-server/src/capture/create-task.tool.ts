import {
  CAPTURE_DAILY_LIMIT_TEXT,
  CAPTURE_NOTES_MAX_BYTES,
  CAPTURE_PROJECT_MAX_CHARS,
  CAPTURE_QUEUE_FULL_TEXT,
  CAPTURE_REPEAT_EVERY_MAX,
  CAPTURE_REVOKED_TEXT,
  CAPTURE_SAVED_PROJECT_TEXT,
  CAPTURE_SAVED_TEXT,
  CAPTURE_SWITCHED_OFF_TEXT,
  CAPTURE_TITLE_MAX_CHARS,
} from './capture.const';
import {
  CAPTURE_REPEAT_CYCLES,
  CAPTURE_WEEKDAYS,
  CaptureRepeat,
  enqueueCapture,
} from './capture-queue.store';
import { AuthenticatedGrant } from './capture-grant.store';
import { isGrantDailyCapReached, recordGrantCreate } from './capture-rate-limit';
import { isRecentCapture, recordCapture, withGrantLock } from './capture-retry-window';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';

const DUE_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const DUE_TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

/**
 * `create_task(title, notes?, dueDate?, dueTime?, repeat?, project?)`: the only tool.
 * Public once shipped: optional fields may be added, nothing removed or renamed.
 */
export const CREATE_TASK_TOOL: McpToolDefinition = {
  name: 'create_task',
  title: 'Add task to Inbox',
  description:
    'Add a task to the Inbox, or to an existing project, in Super ' +
    'Productivity. Text is kept literally: ' +
    '#tags, +projects and dates in the title or notes are not parsed; pass ' +
    'dueDate (and optionally dueTime) to schedule the task, repeat to make ' +
    'it recurring, and project to name the project. This tool cannot read ' +
    'tasks or projects.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: `Task title, 1 to ${CAPTURE_TITLE_MAX_CHARS} characters.`,
        minLength: 1,
        maxLength: CAPTURE_TITLE_MAX_CHARS,
      },
      notes: {
        type: 'string',
        description: 'Optional notes, up to 8 KiB.',
      },
      dueDate: {
        type: 'string',
        description:
          "Optional day to schedule the task for, as YYYY-MM-DD in the user's " +
          'local calendar.',
        pattern: DUE_DATE_PATTERN,
      },
      dueTime: {
        type: 'string',
        description:
          "Optional start time on dueDate, as 24-hour HH:MM in the user's local " +
          'time zone. Requires dueDate. Without it the task is due on the day, ' +
          'with no time.',
        pattern: DUE_TIME_PATTERN,
      },
      repeat: {
        type: 'object',
        description:
          'Optional: make the task recurring, starting on dueDate (or today). ' +
          'dueTime, if given, is the time of every occurrence. A monthly or ' +
          "yearly task repeats on the start day's date.",
        properties: {
          cycle: { type: 'string', enum: [...CAPTURE_REPEAT_CYCLES] },
          every: {
            type: 'integer',
            description: `Repeat every N cycles, 1 to ${CAPTURE_REPEAT_EVERY_MAX}. Default 1.`,
            minimum: 1,
            maximum: CAPTURE_REPEAT_EVERY_MAX,
          },
          weekdays: {
            type: 'array',
            description:
              "Weekly only: the days it repeats on. Default: the start day's weekday.",
            items: { type: 'string', enum: [...CAPTURE_WEEKDAYS] },
            minItems: 1,
            uniqueItems: true,
          },
        },
        required: ['cycle'],
        additionalProperties: false,
      },
      project: {
        type: 'string',
        description:
          'Optional: the name of an existing project to add the task to, ' +
          'matched ignoring case. If no single open project has this name, ' +
          'the task goes to the Inbox. Hidden projects and projects linked ' +
          'to an issue tracker are never used. Projects are never created.',
        minLength: 1,
        maxLength: CAPTURE_PROJECT_MAX_CHARS,
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  // Adds and never overwrites. Not idempotent: the retry window merges an
  // identical call for 10 minutes only. Touches only the user's own Inbox or
  // one of their existing projects.
  annotations: {
    title: 'Add task to Inbox',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const text = (message: string, isError = false): McpToolResult => ({
  content: [{ type: 'text', text: message }],
  ...(isError ? { isError: true } : {}),
});

export type CreateTaskArgs = {
  title: string;
  notes?: string;
  /** `YYYY-MM-DD`, a real calendar day. */
  dueDate?: string;
  /** `HH:MM`, 24-hour; only with `dueDate`. */
  dueTime?: string;
  repeat?: CaptureRepeat;
  /** Trimmed project title; matched on the importing device. */
  project?: string;
};

const ARG_NAMES = ['title', 'notes', 'dueDate', 'dueTime', 'repeat', 'project'];
const REPEAT_KEYS = ['cycle', 'every', 'weekdays'];
const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
const DUE_TIME_RE = new RegExp(DUE_TIME_PATTERN);

/**
 * Rejects shapes like 2026-02-30 that the pattern lets through, and years
 * before 1000: the app writes those days without zero padding (`500-06-15`),
 * which a repeating capture turns into NaN dates (same floor as the Local REST
 * API's repeat startDate).
 */
const isCalendarDay = (day: string): boolean => {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return (
    year >= 1000 &&
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === date
  );
};

/** Returns the validated due fields, or the message to send back as a tool error. */
const validateDue = (
  args: Record<string, unknown>,
): Pick<CreateTaskArgs, 'dueDate' | 'dueTime'> | string => {
  const { dueDate, dueTime } = args;
  if (dueDate === undefined) {
    return dueTime === undefined ? {} : 'dueTime requires dueDate';
  }
  if (
    typeof dueDate !== 'string' ||
    !DUE_DATE_RE.test(dueDate) ||
    !isCalendarDay(dueDate)
  ) {
    return 'dueDate must be a calendar day as YYYY-MM-DD';
  }
  if (dueTime === undefined) return { dueDate };
  if (typeof dueTime !== 'string' || !DUE_TIME_RE.test(dueTime)) {
    return 'dueTime must be a 24-hour time as HH:MM';
  }
  return { dueDate, dueTime };
};

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/**
 * Returns the repeat in canonical form (no `every: 1`, weekdays in Monday-first
 * order), so identical retries share one retry-window key; or the error message.
 */
const validateRepeat = (value: unknown): CaptureRepeat | undefined | string => {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'repeat must be an object';
  }
  const r = value as Record<string, unknown>;
  const unknownKey = Object.keys(r).find((key) => !REPEAT_KEYS.includes(key));
  if (unknownKey !== undefined) return `Unknown argument: repeat.${unknownKey}`;
  if (!isOneOf(CAPTURE_REPEAT_CYCLES, r.cycle)) {
    return `repeat.cycle must be one of ${CAPTURE_REPEAT_CYCLES.join(', ')}`;
  }
  const repeat: CaptureRepeat = { cycle: r.cycle };
  if (r.every !== undefined) {
    if (
      typeof r.every !== 'number' ||
      !Number.isInteger(r.every) ||
      r.every < 1 ||
      r.every > CAPTURE_REPEAT_EVERY_MAX
    ) {
      return `repeat.every must be a whole number from 1 to ${CAPTURE_REPEAT_EVERY_MAX}`;
    }
    if (r.every > 1) repeat.every = r.every;
  }
  if (r.weekdays !== undefined) {
    if (r.cycle !== 'weekly') return 'repeat.weekdays needs cycle weekly';
    const days = r.weekdays;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((day) => isOneOf(CAPTURE_WEEKDAYS, day)) ||
      new Set(days).size !== days.length
    ) {
      return `repeat.weekdays must be distinct days out of ${CAPTURE_WEEKDAYS.join(', ')}`;
    }
    repeat.weekdays = CAPTURE_WEEKDAYS.filter((day) => days.includes(day));
  }
  return repeat;
};

/** Returns the trimmed project title, or the error message. */
const validateProject = (value: unknown): string | undefined | { error: string } => {
  if (value === undefined) return undefined;
  const error = { error: `project must be 1 to ${CAPTURE_PROJECT_MAX_CHARS} characters` };
  if (typeof value !== 'string') return error;
  const project = value.trim();
  const chars = [...project].length;
  return chars === 0 || chars > CAPTURE_PROJECT_MAX_CHARS ? error : project;
};

/** Returns the validated arguments, or the message to send back as a tool error. */
export const validateCreateTaskArgs = (
  args: Record<string, unknown>,
): CreateTaskArgs | string => {
  const unknown = Object.keys(args).find((key) => !ARG_NAMES.includes(key));
  if (unknown !== undefined) return `Unknown argument: ${unknown}`;
  if (typeof args.title !== 'string') return 'title must be a string';
  const title = args.title.trim();
  // Counted in code points, so emoji and CJK count as one character each.
  const titleChars = [...title].length;
  if (titleChars === 0 || titleChars > CAPTURE_TITLE_MAX_CHARS) {
    return `title must be 1 to ${CAPTURE_TITLE_MAX_CHARS} characters`;
  }
  const dueOnly = validateDue(args);
  if (typeof dueOnly === 'string') return dueOnly;
  const repeat = validateRepeat(args.repeat);
  if (typeof repeat === 'string') return repeat;
  const project = validateProject(args.project);
  if (typeof project === 'object') return project.error;
  const extra = {
    ...dueOnly,
    ...(repeat ? { repeat } : {}),
    ...(project === undefined ? {} : { project }),
  };
  if (args.notes === undefined) return { title, ...extra };
  if (typeof args.notes !== 'string') return 'notes must be a string';
  if (Buffer.byteLength(args.notes, 'utf8') > CAPTURE_NOTES_MAX_BYTES) {
    return 'notes must be at most 8 KiB';
  }
  return args.notes.length === 0
    ? { title, ...extra }
    : { title, notes: args.notes, ...extra };
};

const savedText = (args: CreateTaskArgs): string =>
  args.project === undefined ? CAPTURE_SAVED_TEXT : CAPTURE_SAVED_PROJECT_TEXT;

export const runCreateTask = async (
  grant: AuthenticatedGrant,
  rawArgs: Record<string, unknown>,
): Promise<McpToolResult> => {
  const args = validateCreateTaskArgs(rawArgs);
  if (typeof args === 'string') return text(args, true);

  return withGrantLock(grant.grantId, async () => {
    if (isRecentCapture(grant.grantId, args)) {
      return text(savedText(args));
    }
    if (isGrantDailyCapReached(grant.grantId)) {
      return text(CAPTURE_DAILY_LIMIT_TEXT, true);
    }
    const result = await enqueueCapture(grant.userId, grant.grantId, {
      v: 1,
      title: args.title,
      ...(args.notes === undefined ? {} : { notes: args.notes }),
      // Optional v1 fields: released apps ignore them and add a one-off,
      // unscheduled task.
      ...(args.dueDate === undefined ? {} : { dueDate: args.dueDate }),
      ...(args.dueTime === undefined ? {} : { dueTime: args.dueTime }),
      ...(args.repeat === undefined ? {} : { repeat: args.repeat }),
      ...(args.project === undefined ? {} : { project: args.project }),
      createdAt: Date.now(),
      client: grant.clientName,
    });
    if (result === 'switched_off') return text(CAPTURE_SWITCHED_OFF_TEXT, true);
    if (result === 'revoked') return text(CAPTURE_REVOKED_TEXT, true);
    if (result === 'queue_full') return text(CAPTURE_QUEUE_FULL_TEXT, true);
    recordCapture(grant.grantId, args);
    recordGrantCreate(grant.grantId);
    return text(savedText(args));
  });
};
