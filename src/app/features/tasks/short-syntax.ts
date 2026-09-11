import { Task, TaskCopy } from './task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { stringToMs } from '../../ui/duration/string-to-ms.pipe';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { isImageUrlSimple } from '../../util/is-image-url';
import { formatTimeHHmm } from '../../util/format-time-hhmm';
import { TaskAttachment } from './task-attachment/task-attachment.model';
import { nanoid } from 'nanoid';
import type { Chrono, ParsingContext, ParsingResult } from 'chrono-node';
import {
  RepeatCycleOption,
  RepeatQuickSetting,
} from '../task-repeat-cfg/task-repeat-cfg.model';
import { TextRange, TrackedTitle } from './tracked-title';
type ProjectChanges = {
  title?: string;
  projectId?: string;
};
type TagChanges = {
  taskChanges: Partial<TaskCopy>;
  newTagTitlesToCreate: string[];
  ranges: TextRange[];
  isTitleChanged: boolean;
};

export type ShortSyntaxTokenType =
  | 'due'
  | 'deadline'
  | 'estimate'
  | 'tag'
  | 'project'
  | 'url';

// A span of the *raw* input consumed by a parse stage, e.g. '@every friday',
// '#home', '+work', '30m/1h'. Used to highlight detected syntax in the input.
// Each stage sees an already-stripped working title, so positions are mapped
// back through the TrackedTitle offset map; a token whose consumed text is
// split by an earlier removal ("@tomorrow evening" around a stripped "1h")
// yields one range per contiguous run.
export interface ShortSyntaxRange {
  type: ShortSyntaxTokenType;
  start: number;
  end: number;
}

// A recurrence parsed from the input. Either one of the dialog's presets
// ("@every friday") or an explicit interval ("@every 2 days"), which has no
// preset because every preset hardcodes `repeatEvery: 1`. An interval becomes a
// `quickSetting: 'CUSTOM'` config — the one setting whose interval the repeat
// dialog can display and round-trip.
export type ShortSyntaxRepeat =
  | { type: 'PRESET'; quickSetting: Exclude<RepeatQuickSetting, 'CUSTOM'> }
  | { type: 'INTERVAL'; repeatCycle: RepeatCycleOption; repeatEvery: number };

const CH_TSP = '/';
// Due how this expression capture clusters of duration units, be mindful of
// match boundary whitespace during processing
export const SHORT_SYNTAX_TIME_REG_EX = new RegExp(
  String.raw`(?:\s|^)t?((?:\d+(?:\.\d+)?[mh]\s*)+)(?:\s*` +
    `\\${CH_TSP}` +
    String.raw`((?:\s*\d+(?:\.\d+)?[mh])+)?)?(?=\s|$)`,
);

const CH_PRO = '+';
const CH_TAG = '#';
const CH_DUE = '@';
const CH_DEADLINE = '!';
const ALL_SPECIAL = `(\\${CH_PRO}|\\${CH_TAG}|\\${CH_DUE}|\\${CH_DEADLINE})`;

let customDateParserPromise: Promise<Chrono> | null = null;
let customDateParserCache: Chrono | null = null;

const loadCustomDateParser = (): Promise<Chrono> => {
  if (customDateParserCache) {
    return Promise.resolve(customDateParserCache);
  }
  if (!customDateParserPromise) {
    customDateParserPromise = import('chrono-node').then(({ casual }) => {
      const parser = casual.clone();
      parser.refiners.push({
        refine: (context: ParsingContext, results: ParsingResult[]) => {
          results.forEach((result) => {
            const { refDate, text, start } = result;
            const regex = / [5-9][0-9]$/;
            const yearIndex = text.search(regex);
            // The year pattern in Chrono's source code is (?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-2][0-9]{3}|[5-9][0-9]|2[0-5]).
            // This means any two-digit numeric value from 50 to 99 will be considered a year.
            // Link: https://github.com/wanasit/chrono/blob/54e7ff12f9185e735ee860c25922b2ab2367d40b/src/locales/en/constants.ts#L234C30-L234C108
            // When someone creates a task like "Test @25/4 90m", Chrono will return
            // the year as 1990, which is an undesirable behaviour in most cases.
            if (yearIndex !== -1) {
              result.text = text.slice(0, yearIndex);
              const current = new Date();
              let year = current.getFullYear();
              const impliedDate = start.get('day');
              const impliedMonth = start.get('month');
              if (
                (impliedMonth && impliedMonth < refDate.getMonth() + 1) ||
                (impliedMonth === refDate.getMonth() + 1 &&
                  impliedDate &&
                  impliedDate < refDate.getDate())
              ) {
                year += 1;
              }
              result.start.assign('year', year);
            }
          });
          return results;
        },
      });
      customDateParserCache = parser;
      return parser;
    });
  }
  return customDateParserPromise;
};

// The following project name extraction pattern attempts to improve on the
// previous version by not immediately terminating upon encountering a short
// syntax delimiting character and looks ahead to consider usage context
const SHORT_SYNTAX_PROJECT_REG_EX = new RegExp(
  `\\${CH_PRO}(?!\\s)((?:(?!\\s+(?:\\${CH_TAG}|\\${CH_DUE}|t?\\d+[mh]\\b)).)+)`,
);
const SHORT_SYNTAX_TAGS_REG_EX = new RegExp(`\\${CH_TAG}[^${ALL_SPECIAL}|\\s]+`, 'gi');

// Literal notation: /\@[^\+|\#|\@]/gi
// Match string starting with the literal @ and followed by 1 or more of the characters
// not in the ALL_SPECIAL
const SHORT_SYNTAX_DUE_REG_EX = new RegExp(`\\${CH_DUE}[^${ALL_SPECIAL}]+`, 'gi');

// Weekday unit → Date.getDay() index; covers abbreviations and singular form
// (plural "fridays" is normalized by stripping the trailing "s" before lookup)
const WEEKDAY_UNITS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const weekdayOfUnit = (unit: string): number | undefined =>
  WEEKDAY_UNITS[unit] ?? WEEKDAY_UNITS[unit.replace(/s$/, '')];

// Full names before abbreviations: alternation is leftmost-first, so listing
// "fri" first would leave the "day" of "friday" behind and fail the phrase-end
// lookahead.
const WEEKDAY_UNIT_SOURCE =
  'mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?' +
  '|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun';

// Recurrence phrase at the start of a due match: a bare frequency word
// ("@daily"), an "every ..." phrase ("@every friday", "@every 15th"), or an
// interval ("@every 2 days", "@every 2 fridays"). Anchored to the start so
// "@some day every year" is parsed as a plain date, not a recurrence. The phrase
// may be followed by whitespace, end-of-input, or trailing punctuation ("water
// plants @every friday.") — chrono is equally punctuation-tolerant for plain
// dates, so without this the dot would demote the whole phrase to a plain
// "friday" date. The ordinal suffix is deliberately not checked against the
// number ("@every 15st" parses as the 15th): typos should still hit the
// recurrence people meant, not fall back to a plain date. Interval counts are
// 1-999: a never-recurring "@every 0 days" falls through to the plain-date path,
// and the upper bound stays one notch inside the dialog's `repeatEvery` max of
// 1000. Excluding them in the grammar rather than in the parse below keeps the
// derived removal regex in step: a bound checked in the parse would leave the
// clear-repeat button deleting "@every 0 days", which the parser never consumed.
// `weekday(s)`/`workday(s)` are deliberately absent from the interval units:
// "every 2 weekdays" means every other workday, which a weekly cycle cannot
// express (five weekday flags plus an interval means every other *week*, all
// five days), so it stays a plain date rather than becoming a wrong schedule.
const REPEAT_PHRASE_SOURCE =
  '(?:(daily|weekly|monthly|yearly|annually)' +
  '|every\\s+(' +
  'days?|weeks?|months?|years?|weekdays?|workdays?' +
  `|${WEEKDAY_UNIT_SOURCE}` +
  '|\\d{1,2}(?:st|nd|rd|th)' +
  ')' +
  `|every\\s+([1-9]\\d{0,2})\\s+(days?|weeks?|months?|years?|${WEEKDAY_UNIT_SOURCE})` +
  ')(?=[\\s.,;:!?]|$)';

const SHORT_SYNTAX_REPEAT_REG_EX = new RegExp('^' + REPEAT_PHRASE_SOURCE, 'i');

// The same grammar re-anchored to the trigger char, for removing a recurrence
// phrase from raw input. Derived rather than hand-written so it cannot drift
// from the parser — a second, broader grammar here silently eats phrases that
// fall through to the plain-date path ("@every quarter", "@every 2 weekdays").
// It is not equivalent to what the parser consumed, though: the parser matches
// at the start of a due match (which ends at the next `+ # @ !`), this scans the
// whole raw input, so the two disagree at the edges — "Task @every friday#tag"
// is a recurrence this regex leaves alone, and "Task @tomorrow @daily" is not
// one but has its second token matched here. Removing the ranges the parser
// recorded is what avoids both (AddTaskBarParserService); this is the fallback
// for when no parse has landed for the text yet. The leading `\s*` also lets
// trailing punctuation join the preceding word, the way applyRepeatSyntax does
// ("Water plants @every friday." → "Water plants.").
export const SHORT_SYNTAX_REPEAT_REMOVAL_REG_EX = new RegExp(
  `\\s*\\${CH_DUE}` + REPEAT_PHRASE_SOURCE,
  'gi',
);

interface RepeatSyntaxResult {
  repeat: ShortSyntaxRepeat;
  // Remainder after the recurrence phrase, run through chrono for an optional
  // time ("3pm" in "@every friday 3pm")
  chronoText: string;
  // Chars of the due match consumed by the recurrence phrase itself
  consumedLength: number;
  // Anchor for the first occurrence; chrono never sees the unit word
  weekday?: number;
  dayOfMonth?: number;
}

// Cycle word ("days", "week", …) → the cycle it repeats on. Shared by the
// interval branch and its every-1 collapse below.
const cycleForUnit = (unit: string): RepeatCycleOption => {
  if (unit.startsWith('day')) {
    return 'DAILY';
  }
  if (unit.startsWith('week')) {
    return 'WEEKLY';
  }
  if (unit.startsWith('month')) {
    return 'MONTHLY';
  }
  // year(s)
  return 'YEARLY';
};

// The preset meaning the same thing as an interval of 1, so "@every 1 week" is
// indistinguishable from "@every week" — same chip label, same skipOverdue
// default, same editable-as-a-preset config.
const PRESET_FOR_CYCLE: Record<
  RepeatCycleOption,
  Exclude<RepeatQuickSetting, 'CUSTOM'>
> = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY_CURRENT_WEEKDAY',
  MONTHLY: 'MONTHLY_CURRENT_DATE',
  YEARLY: 'YEARLY_CURRENT_DATE',
};

const parseRepeatSyntax = (dueMatchContent: string): RepeatSyntaxResult | null => {
  const m = dueMatchContent.match(SHORT_SYNTAX_REPEAT_REG_EX);
  if (!m) {
    return null;
  }
  const bareWord = m[1]?.toLowerCase();
  const unit = m[2]?.toLowerCase();
  const intervalCount = m[3];
  const intervalUnit = m[4]?.toLowerCase();
  const remainder = dueMatchContent.slice(m[0].length);

  const result = (
    repeat: ShortSyntaxRepeat,
    anchor?: { weekday?: number; dayOfMonth?: number },
  ): RepeatSyntaxResult => ({
    repeat,
    chronoText: remainder,
    consumedLength: m[0].length,
    ...anchor,
  });

  const preset = (
    quickSetting: Exclude<RepeatQuickSetting, 'CUSTOM'>,
    anchor?: { weekday?: number; dayOfMonth?: number },
  ): RepeatSyntaxResult => result({ type: 'PRESET', quickSetting }, anchor);

  if (intervalUnit) {
    // 1-999 by grammar, so no range check is needed here
    const repeatEvery = +intervalCount;
    // "@every 2 fridays" — a weekly interval that names its own weekday instead
    // of taking today's
    const intervalWeekday = weekdayOfUnit(intervalUnit);
    if (intervalWeekday !== undefined) {
      const anchor = { weekday: intervalWeekday };
      return repeatEvery === 1
        ? preset('WEEKLY_CURRENT_WEEKDAY', anchor)
        : result({ type: 'INTERVAL', repeatCycle: 'WEEKLY', repeatEvery }, anchor);
    }
    const repeatCycle = cycleForUnit(intervalUnit);
    return repeatEvery === 1
      ? preset(PRESET_FOR_CYCLE[repeatCycle])
      : result({ type: 'INTERVAL', repeatCycle, repeatEvery });
  }

  if (bareWord) {
    switch (bareWord) {
      case 'daily':
        return preset('DAILY');
      case 'weekly':
        return preset('WEEKLY_CURRENT_WEEKDAY');
      case 'monthly':
        return preset('MONTHLY_CURRENT_DATE');
      default:
        // yearly | annually
        return preset('YEARLY_CURRENT_DATE');
    }
  }

  const weekday = weekdayOfUnit(unit);
  if (weekday !== undefined) {
    return preset('WEEKLY_CURRENT_WEEKDAY', { weekday });
  }

  const ordinalMatch = unit.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
  if (ordinalMatch) {
    const dayOfMonth = +ordinalMatch[1];
    if (dayOfMonth < 1 || dayOfMonth > 31) {
      return null;
    }
    return preset('MONTHLY_CURRENT_DATE', { dayOfMonth });
  }

  if (unit.startsWith('weekday') || unit.startsWith('workday')) {
    return preset('MONDAY_TO_FRIDAY');
  }
  return preset(PRESET_FOR_CYCLE[cycleForUnit(unit)]);
};

// Next date falling on the given weekday, today or later, at 12:00 (mirrors
// chrono's implied-time default so the downstream dueDay conversion matches)
const getNextWeekdayDate = (now: Date, weekday: number): Date => {
  const diff = (weekday - now.getDay() + 7) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 12, 0);
};

// Next date with the given day-of-month, today or later; months without that
// day (e.g. "every 31st" in February) are skipped rather than clamped to the
// month's last day. The repeat engine takes the recurring day-of-month from
// the start date (`startDateDate.getDate()` in get-next-repeat-occurrence.util)
// and only clamps from there, so clamping here would turn "@every 31st" typed
// in February into a permanent "every 28th". Skipping costs one late first
// occurrence (Mar 31); every later month then clamps as usual (Apr 30, May 31).
const getNextDayOfMonthDate = (now: Date, dayOfMonth: number): Date | null => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 24; i++) {
    const candidate = new Date(now.getFullYear(), now.getMonth() + i, dayOfMonth, 12, 0);
    if (candidate.getDate() === dayOfMonth && candidate >= startOfToday) {
      return candidate;
    }
  }
  return null;
};
const SHORT_SYNTAX_DEADLINE_REG_EX = new RegExp(
  `\\${CH_DEADLINE}[^${ALL_SPECIAL}]+`,
  'gi',
);

// Match URLs with protocol (http, https, file) or www prefix
// Matches URLs but excludes trailing punctuation
const SHORT_SYNTAX_URL_REG_EX = new RegExp(
  String.raw`(?:(?:https?|file)://\S+|www\.\S+?)(?=\s|$)`,
  'gi',
);

// Markdown link regex: [title](url)
// Allows one level of balanced parentheses inside the URL so that links like
// [article](https://en.wikipedia.org/wiki/C_(programming_language)) work.
const SHORT_SYNTAX_MARKDOWN_LINK_REG_EX =
  /\[([^\]]+)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

// Non-Task marker fields that ride along in taskChanges for consumers to read
// and that must be stripped before persisting (see short-syntax.effects).
// Consumers reach the fields structurally through shortSyntax's return type,
// so the interface is deliberately not exported.
interface ShortSyntaxMarkers {
  hasDeadlineTime?: boolean;
  /**
   * The typed wall-clock time as HH:mm. dueWithTime alone cannot carry it when
   * the resolved day is a DST spring-forward day on which that time does not
   * exist: the timestamp reads back shifted, and the repeat config's startTime
   * would inherit the shift for every later occurrence, where the time exists.
   */
  dueTimeStr?: string;
}

export const shortSyntax = async (
  task: Task | Partial<Task>,
  config: ShortSyntaxConfig,
  allTags?: Tag[],
  allProjects?: Project[],
  now = new Date(),
  mode: 'combine' | 'replace' = 'combine',
  // Recurrence syntax ("@every friday") is only meaningful where a repeat cfg
  // can be created for the result — the add-task bar. Title edits of existing
  // tasks keep parsing it as a plain date.
  isParseRepeat: boolean = false,
): Promise<
  | {
      taskChanges: Partial<Task> & ShortSyntaxMarkers;
      newTagTitles: string[];
      remindAt: number | null;
      projectId: string | undefined;
      attachments: TaskAttachment[];
      repeat: ShortSyntaxRepeat | null;
      parsedRanges: ShortSyntaxRange[];
    }
  | undefined
> => {
  if (!task.title) {
    return;
  }
  if (typeof task.title !== 'string') {
    throw new Error('No str');
  }

  // TODO clean up this mess
  let taskChanges: Partial<TaskCopy> & ShortSyntaxMarkers = {};
  let projectId: string | undefined;
  let newTagTitles: string[] = [];
  let attachments: TaskAttachment[] = [];
  let repeat: ShortSyntaxRepeat | null = null;
  const parsedRanges: ShortSyntaxRange[] = [];
  // The working title all stages strip from; maps every surviving character
  // back to its raw-input position so consumed spans highlight exactly.
  const tracked = new TrackedTitle(task.title);
  let isTitleChanged = false;
  const pushRanges = (type: ShortSyntaxTokenType, ranges: TextRange[]): void => {
    ranges.forEach((r) => parsedRanges.push({ type, ...r }));
  };

  if (config.isEnableDue) {
    const timeResult = parseTimeSpentTracked(task, tracked);
    if (timeResult) {
      taskChanges = { ...timeResult.changes };
      pushRanges('estimate', timeResult.ranges);
      isTitleChanged = true;
    }
    const dueResult = await parseScheduledDate(tracked, now, isParseRepeat);
    if (dueResult) {
      repeat = dueResult.repeat || null;
      taskChanges = { ...taskChanges, ...dueResult.changes };
      pushRanges('due', dueResult.ranges);
      isTitleChanged = true;
    }
  }

  if (config.isEnableDeadline) {
    const deadlineResult = await parseDeadlineDate(tracked, now);
    if (deadlineResult) {
      taskChanges = { ...taskChanges, ...deadlineResult.changes };
      pushRanges('deadline', deadlineResult.ranges);
      isTitleChanged = true;
    }
  }

  if (config.isEnableProject) {
    const projectResult = parseProjectTracked(
      task,
      tracked,
      allProjects?.filter((p) => !p.isArchived && !p.isHiddenFromMenu),
    );
    if (projectResult) {
      projectId = projectResult.projectId;
      pushRanges('project', projectResult.ranges);
      isTitleChanged = true;
    }
  }

  if (config.isEnableTag) {
    const tagResult = parseTagChanges(task, tracked, allTags, mode);
    taskChanges = {
      ...taskChanges,
      ...tagResult.taskChanges,
    };
    newTagTitles = tagResult.newTagTitlesToCreate;
    pushRanges('tag', tagResult.ranges);
    isTitleChanged = isTitleChanged || tagResult.isTitleChanged;
  }

  if (isTitleChanged) {
    taskChanges.title = tracked.text;
  }

  const urlChanges = parseUrlAttachments(task, tracked, config);
  if (urlChanges) {
    if (urlChanges.attachments.length > 0) {
      attachments = urlChanges.attachments;
    }
    taskChanges = {
      ...taskChanges,
      title: urlChanges.title,
    };
    pushRanges('url', urlChanges.ranges);
  }

  if (Object.keys(taskChanges).length === 0 && attachments.length === 0) {
    return undefined;
  }

  parsedRanges.sort((a, b) => a.start - b.start);

  return {
    taskChanges,
    newTagTitles,
    remindAt: null,
    projectId,
    attachments,
    repeat,
    parsedRanges,
  };
};

export const parseProjectChanges = (
  task: Partial<TaskCopy>,
  allProjects?: Project[],
): ProjectChanges => {
  if (!task.title) {
    return {};
  }
  const tracked = new TrackedTitle(task.title);
  const result = parseProjectTracked(task, tracked, allProjects);
  return result ? { title: tracked.text, projectId: result.projectId } : {};
};

type MatchableProject = {
  id: string;
  words: string[];
  /** title with all whitespace removed, to match titles typed without spaces */
  squashedTitle: string;
  titleLength: number;
};

const toWords = (title: string): string[] => title.trim().toLowerCase().split(/\s+/);

const toMatchableProject = (project: Project): MatchableProject => ({
  id: project.id,
  words: toWords(project.title),
  squashedTitle: project.title.replaceAll(' ', '').toLowerCase(),
  titleLength: project.title.length,
});

const isFullyTypedProjectTitle = (
  project: MatchableProject,
  typedWords: string[],
): boolean =>
  project.words.length === typedWords.length &&
  project.words.every((word, i) => word === typedWords[i]);

// A partially typed title may only shorten its last word ("+Some Pro"), otherwise
// task content would get pulled into the project title ("+Home work on taxes" must
// not match a project "Homework"). A single word may also be typed without any
// whitespace at all ("+SomePro").
const isPartiallyTypedProjectTitle = (
  project: MatchableProject,
  typedWords: string[],
): boolean =>
  typedWords.length === 1
    ? project.squashedTitle.startsWith(typedWords[0])
    : typedWords.length <= project.words.length &&
      typedWords.every((word, i) =>
        i === typedWords.length - 1
          ? project.words[i].startsWith(word)
          : project.words[i] === word,
      );

const parseProjectTracked = (
  task: Partial<TaskCopy>,
  tracked: TrackedTitle,
  allProjects?: Project[],
): { projectId: string; ranges: TextRange[] } | null => {
  if (
    task.issueId || // don't allow for issue tasks
    !tracked.text ||
    !Array.isArray(allProjects) ||
    allProjects.length === 0
  ) {
    return null;
  }

  const rr = tracked.text.match(SHORT_SYNTAX_PROJECT_REG_EX);

  if (rr && rr[0]) {
    const projectTitle: string = rr[0].trim().replace(CH_PRO, '');
    const projectTitleToMatch = projectTitle.replaceAll(' ', '').toLowerCase();
    const indexBeforePlus =
      tracked.text.toLowerCase().lastIndexOf(CH_PRO + projectTitleToMatch) - 1;
    const charBeforePlus = tracked.text.charAt(indexBeforePlus);

    // don't parse Fun title+blu as project
    if (charBeforePlus && charBeforePlus !== ' ') {
      return null;
    }

    const consume = (matchedText: string): TextRange[] => {
      const start = tracked.text.indexOf(matchedText);
      if (start === -1) {
        return [];
      }
      const ranges = tracked.rawRanges(start, start + matchedText.length);
      tracked.remove(start, start + matchedText.length);
      tracked.trim();
      // get rid of excess whitespace a mid-title removal leaves behind
      const doubleSpaceIdx = tracked.text.indexOf('  ');
      if (doubleSpaceIdx !== -1) {
        tracked.remove(doubleSpaceIdx, doubleSpaceIdx + 1);
      }
      return ranges;
    };

    // Prefer shortest prefix-based project title match
    const matchableProjects = allProjects
      .map(toMatchableProject)
      .sort((p1, p2) => p1.titleLength - p2.titleLength);

    // The match candidate also contains whatever was typed after the project name
    // (e.g. "+Some Project Title do the thing"), so walk the word prefixes of the
    // candidate from the longest down and only consume the words that actually
    // belong to the project title. A prefix with more words than the longest
    // project title can never match, which also bounds the walk for long input.
    const maxNrOfWords = matchableProjects.reduce(
      (max, project) => Math.max(max, project.words.length),
      0,
    );
    const candidateWordEnds = [...projectTitle.matchAll(/\S+/g)].map(
      (match) => (match.index ?? 0) + match[0].length,
    );

    const findLongestTypedPrefix = (
      isMatch: (project: MatchableProject, typedWords: string[]) => boolean,
    ): { projectId: string; typedTitle: string } | null => {
      for (
        let nrOfWords = Math.min(candidateWordEnds.length, maxNrOfWords);
        nrOfWords > 0;
        nrOfWords--
      ) {
        const typedTitle = projectTitle.slice(0, candidateWordEnds[nrOfWords - 1]);
        const typedWords = toWords(typedTitle);
        const project = matchableProjects.find((p) => isMatch(p, typedWords));
        if (project) {
          return { projectId: project.id, typedTitle };
        }
      }
      return null;
    };

    // A fully typed title (what the autocomplete inserts) always wins, so that
    // "+Work in progress" stays in project "Work" even when "Work Inbox" exists
    const match =
      findLongestTypedPrefix(isFullyTypedProjectTitle) ||
      findLongestTypedPrefix(isPartiallyTypedProjectTitle);

    if (match) {
      return {
        projectId: match.projectId,
        ranges: consume(`${CH_PRO}${match.typedTitle}`),
      };
    }
  }

  return null;
};

const parseTagChanges = (
  task: Partial<TaskCopy>,
  tracked: TrackedTitle,
  allTags?: Tag[],
  mode: 'combine' | 'replace' = 'combine',
): TagChanges => {
  const taskChanges: Partial<TaskCopy> = {};

  const newTagTitlesToCreate: string[] = [];
  const ranges: TextRange[] = [];
  let isTitleChanged = false;
  // only exec if previous ones are also passed
  if (Array.isArray(task.tagIds) && Array.isArray(allTags)) {
    const initialTitle = tracked.text;
    const regexTagTitles = initialTitle.match(SHORT_SYNTAX_TAGS_REG_EX);

    if (regexTagTitles && regexTagTitles.length) {
      const regexTagTitlesTrimmedAndFiltered: string[] = regexTagTitles
        .map((title) => title.trim().replace(CH_TAG, ''))
        .filter((newTagTitle) => {
          const charBeforeTag = initialTitle.charAt(
            initialTitle.lastIndexOf(CH_TAG + newTagTitle) - 1,
          );
          // don't parse Fun title#blu as tag
          if (charBeforeTag && charBeforeTag !== ' ') {
            return false;
          }

          const trimmedTitle = initialTitle.trim();
          const tagStartIndex = trimmedTitle.lastIndexOf(`${CH_TAG}${newTagTitle}`);
          const isNumericOnly = /^[0-9]+$/.test(newTagTitle);

          return (
            newTagTitle.length >= 1 &&
            tagStartIndex !== -1 &&
            // NOTE: block numeric tags at the start, and any numeric tag on issue tasks
            (!isNumericOnly || (tagStartIndex > 0 && !task.issueId))
          );
        });

      const matchingTagIds: string[] = [];
      regexTagTitlesTrimmedAndFiltered.forEach((newTagTitle) => {
        const existingTag = allTags.find(
          (tag) => newTagTitle.toLowerCase() === tag.title.toLowerCase(),
        );
        if (existingTag) {
          matchingTagIds.push(existingTag.id);
        } else {
          newTagTitlesToCreate.push(newTagTitle);
        }
      });

      if (mode === 'replace') {
        // Check if arrays arent the same
        if (
          !(
            task.tagIds.length === matchingTagIds.length &&
            task.tagIds.every((val, i) => val === matchingTagIds[i])
          )
        ) {
          taskChanges.tagIds = matchingTagIds;
        }
      } else {
        const tagIdsToAdd: string[] = [];
        matchingTagIds.forEach((id) => {
          if (!task.tagIds?.includes(id)) {
            tagIdsToAdd.push(id);
          }
        });
        if (tagIdsToAdd.length) {
          taskChanges.tagIds = [...(task.tagIds as string[]), ...tagIdsToAdd];
        }
      }

      if (regexTagTitlesTrimmedAndFiltered.length) {
        regexTagTitlesTrimmedAndFiltered.forEach((tagTitle) => {
          const matchedText = `${CH_TAG}${tagTitle}`;
          const start = tracked.text.indexOf(matchedText);
          if (start !== -1) {
            ranges.push(...tracked.rawRanges(start, start + matchedText.length));
            tracked.remove(start, start + matchedText.length);
          }
        });
        tracked.trim();
        isTitleChanged = true;
      }
    }
  }

  return {
    taskChanges,
    newTagTitlesToCreate,
    ranges,
    isTitleChanged,
  };
};

// Result of a date-like stage: the task field changes plus the raw-input
// ranges of the consumed syntax (the working-title edit happens on `tracked`)
interface DateStageResult {
  changes: Partial<TaskCopy> & ShortSyntaxMarkers;
  repeat?: ShortSyntaxRepeat;
  ranges: TextRange[];
}

const parseShortSyntaxDate = async (
  tracked: TrackedTitle,
  now: Date,
  regEx: RegExp,
  isDeadline: boolean,
  isParseRepeat: boolean = false,
): Promise<DateStageResult | null> => {
  if (!tracked.text) {
    return null;
  }
  const rr = tracked.text.match(regEx);

  if (rr && rr[0]) {
    if (isDeadline) {
      // Check if the character before trigger is a space or start of string
      const indexBeforeTrigger = tracked.text.indexOf(rr[0]) - 1;
      const charBeforeTrigger =
        indexBeforeTrigger >= 0 ? tracked.text.charAt(indexBeforeTrigger) : '';
      if (charBeforeTrigger && charBeforeTrigger !== ' ') {
        return null;
      }
    }

    if (!isDeadline && isParseRepeat) {
      const repeatResult = parseRepeatSyntax(rr[0].substring(1));
      if (repeatResult) {
        return await applyRepeatSyntax(tracked, now, rr[0], repeatResult);
      }
    }

    const dateParser = await loadCustomDateParser();
    const parsedDateArr = dateParser.parse(rr[0], now, {
      forwardDate: true,
    });

    // Strip out the short syntax for scheduled date and given date
    const consume = (textToReplace: string): TextRange[] => {
      const removeStart = tracked.text.indexOf(textToReplace);
      if (removeStart === -1) {
        return [];
      }
      const ranges = tracked.rawRanges(removeStart, removeStart + textToReplace.length);
      tracked.remove(removeStart, removeStart + textToReplace.length);
      tracked.trim();
      return ranges;
    };

    if (parsedDateArr.length) {
      const parsedDateResult = parsedDateArr[0];
      const start = parsedDateResult.start;
      const due = start.date().getTime();
      let hasPlannedTime = true;
      // If user doesn't explicitly enter time, set the scheduled date
      // to 9:00:00 of the given day

      if (!start.isCertain('hour')) {
        hasPlannedTime = false;
      }

      const matchText = parsedDateResult.text;
      const matchIndex = parsedDateResult.index;
      const textToReplace = rr[0].substring(0, matchIndex + matchText.length);
      const ranges = consume(textToReplace);

      if (isDeadline) {
        return {
          changes: {
            deadlineWithTime: due,
            deadlineDay: null,
            hasDeadlineTime: hasPlannedTime,
          },
          ranges,
        };
      } else {
        return {
          changes: {
            dueWithTime: due,
            dueDay: null,
            ...(hasPlannedTime ? {} : { hasPlannedTime: false }),
          },
          ranges,
        };
      }
    }

    const simpleMatch = rr[0].match(/\d+/);
    if (simpleMatch && simpleMatch[0] && typeof +simpleMatch[0] === 'number') {
      const nr = +simpleMatch[0];
      if (nr <= 24) {
        const due = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          nr,
          0,
          0,
          0,
        );

        // If the scheduled time has already passed today, schedule for tomorrow
        if (due.getTime() <= now.getTime()) {
          due.setDate(due.getDate() + 1);
        }

        const matchIndex = simpleMatch.index as number;
        const matchText = simpleMatch[0];
        const textToReplace = rr[0].substring(0, matchIndex + matchText.length);
        const ranges = consume(textToReplace);

        if (isDeadline) {
          return {
            changes: { deadlineWithTime: due.getTime(), deadlineDay: null },
            ranges,
          };
        } else {
          return {
            changes: { dueWithTime: due.getTime(), dueDay: null },
            ranges,
          };
        }
      }
    }
  }

  return null;
};

// The cycle a recurrence's first occurrence has to be anchored to, or null when
// the schedule has no anchor to preserve (DAILY / MONDAY_TO_FRIDAY: every day
// resp. every workday is an occurrence, so the first one needs no alignment).
// The callers below test the result against the anchored cycles by name, so
// "no anchor" is expressed by returning null — nothing checks for DAILY.
const anchorCycleOf = (repeat: ShortSyntaxRepeat): RepeatCycleOption | null => {
  if (repeat.type === 'INTERVAL') {
    return repeat.repeatCycle === 'DAILY' ? null : repeat.repeatCycle;
  }
  switch (repeat.quickSetting) {
    case 'WEEKLY_CURRENT_WEEKDAY':
      return 'WEEKLY';
    case 'MONTHLY_CURRENT_DATE':
      return 'MONTHLY';
    case 'YEARLY_CURRENT_DATE':
      return 'YEARLY';
    default:
      return null;
  }
};

// MONDAY_TO_FRIDAY has no weekday to anchor to, but it does exclude two:
// chrono's forwardDate slide lands on the weekend for "@every weekday 6am"
// typed on a Friday after 06:00. The occurrence engine skips to Monday off the
// config's weekday flags (getFirstRepeatOccurrence), so leaving the weekend
// date in place would only make the add bar advertise a first occurrence the
// task never gets. Mutates in place, like the roll-forward above.
// Exported because the add bar's menus reach the same combination without any
// syntax — see add-task-bar/roll-weekend-date-for-repeat.ts.
export const skipExcludedWeekend = (date: Date): void => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  // A skipped-over day can be a DST spring-forward day whose 02:00-03:00 hour
  // does not exist; stepping through it would silently shift the clock time,
  // and that time is read back into the repeat config's startTime.
  date.setHours(hours, minutes);
};

// Resolves a matched recurrence phrase into task changes: the parsed repeat
// plus an optional anchor date/time parsed from what follows the phrase
// ("@every friday 3pm" → next Friday 15:00), with the consumed syntax stripped
// from the title.
const applyRepeatSyntax = async (
  tracked: TrackedTitle,
  now: Date,
  dueMatch: string,
  repeatResult: RepeatSyntaxResult,
): Promise<DateStageResult> => {
  const { repeat, chronoText, consumedLength, weekday, dayOfMonth } = repeatResult;
  const anchorCycle = anchorCycleOf(repeat);
  const dateParser = await loadCustomDateParser();
  const parsedDateArr = chronoText
    ? dateParser.parse(chronoText, now, { forwardDate: true })
    : [];
  // Only absorb a chrono match that directly follows the phrase ("@every
  // friday 3pm"). A match further into the remainder belongs to the title
  // ("Standup @every monday and friday") — absorbing it would swallow every
  // word in between.
  const parsedDateResult =
    parsedDateArr.length && /^\s*$/.test(chronoText.slice(0, parsedDateArr[0].index))
      ? parsedDateArr[0]
      : null;
  // Chars of the due match consumed in total (incl. the trigger char) — the
  // recurrence phrase itself plus the adjacent chrono match, if any
  const consumedTotal =
    1 +
    consumedLength +
    (parsedDateResult ? parsedDateResult.index + parsedDateResult.text.length : 0);
  const textToReplace = dueMatch.substring(0, consumedTotal);
  const tokenStart = tracked.text.indexOf(textToReplace);
  const tokenEnd = tokenStart + textToReplace.length;
  const ranges = tracked.rawRanges(tokenStart, tokenEnd);
  const head = tracked.text.slice(0, tokenStart);
  const tail = tracked.text.slice(tokenEnd);
  // Trailing punctuation stays in the title; join it to the preceding word so
  // "Water plants @every friday." becomes "Water plants." and not
  // "Water plants .". A mid-title phrase must not leave a double space either.
  if (/^[.,;:!?]/.test(tail)) {
    let wsStart = tokenStart;
    while (wsStart > 0 && /\s/.test(tracked.text[wsStart - 1])) {
      wsStart--;
    }
    tracked.remove(wsStart, tokenEnd);
  } else if (/\s$/.test(head) && /^\s/.test(tail)) {
    const tailWs = tail.match(/^\s+/);
    tracked.remove(tokenStart, tokenEnd + (tailWs ? tailWs[0].length : 0));
  } else {
    tracked.remove(tokenStart, tokenEnd);
  }
  tracked.trim();
  const hasTime = !!parsedDateResult && parsedDateResult.start.isCertain('hour');

  // A time-only remainder ("6am") says nothing about which day the recurrence
  // falls on — but chrono's forwardDate has already slid an already-passed time
  // to tomorrow. The *_CURRENT_* presets mean "today's weekday / today's date"
  // (and an interval anchors its whole cycle on the first occurrence just the
  // same), so taking chrono's date verbatim would make "@weekly 6am" typed on a
  // Wednesday morning recur on Thursdays. Pin them to today and let the
  // roll-forward below advance a whole period instead, exactly like "@every
  // wednesday 6am". Unanchored schedules (DAILY, MONDAY_TO_FRIDAY) fall through
  // all three checks: every day resp. every workday is an occurrence, so
  // chrono's slide to tomorrow is already the correct first one — except when it
  // slides onto a weekend, which the workday preset excludes (see
  // skipExcludedWeekend below).
  const isTimeOnlyMatch =
    hasTime &&
    !!parsedDateResult &&
    !parsedDateResult.start.isCertain('day') &&
    !parsedDateResult.start.isCertain('weekday');
  const anchorWeekday =
    weekday ?? (isTimeOnlyMatch && anchorCycle === 'WEEKLY' ? now.getDay() : undefined);
  const anchorDayOfMonth =
    dayOfMonth ??
    (isTimeOnlyMatch && anchorCycle === 'MONTHLY' ? now.getDate() : undefined);

  let anchorDate =
    anchorWeekday !== undefined
      ? getNextWeekdayDate(now, anchorWeekday)
      : anchorDayOfMonth !== undefined
        ? getNextDayOfMonthDate(now, anchorDayOfMonth)
        : isTimeOnlyMatch && anchorCycle === 'YEARLY'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0)
          : null;

  if (anchorDate) {
    // Captured from the chrono result, not from anchorDate after the mutations
    // below: the anchor (or a roll below) can land on a DST spring-forward day
    // where the typed time does not exist, and anchorDate can then only hold
    // the shifted hour. Reading the chrono Date is safe the other way around:
    // chrono's own validity filter drops any parse whose resolved day would
    // normalize the typed time (getHours() != get('hour')), so `parsed` can
    // never itself carry a shifted hour — it can only be absent entirely.
    let typedTimeStr: string | undefined;
    if (hasTime && parsedDateResult) {
      const parsed = parsedDateResult.start.date();
      typedTimeStr = formatTimeHHmm(parsed);
      anchorDate.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
      // "@every friday 3pm" typed on a Friday after 15:00 must not create a
      // task due in the past — advance one period, like chrono's forwardDate
      // does for the plain "@friday 3pm" form
      if (anchorDate.getTime() <= now.getTime()) {
        if (anchorCycle === 'WEEKLY') {
          anchorDate.setDate(anchorDate.getDate() + 7);
        } else if (anchorCycle === 'YEARLY') {
          anchorDate.setFullYear(anchorDate.getFullYear() + 1);
        } else if (anchorDayOfMonth !== undefined) {
          const rolled = getNextDayOfMonthDate(
            new Date(
              anchorDate.getFullYear(),
              anchorDate.getMonth(),
              anchorDate.getDate() + 1,
            ),
            anchorDayOfMonth,
          );
          if (rolled) {
            rolled.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
            anchorDate = rolled;
          }
        }
      }
    }
    return {
      changes: {
        dueWithTime: anchorDate.getTime(),
        dueDay: null,
        ...(hasTime ? { dueTimeStr: typedTimeStr } : { hasPlannedTime: false }),
      },
      repeat,
      ranges,
    };
  }

  if (parsedDateResult) {
    const due = parsedDateResult.start.date();
    // Before skipExcludedWeekend, which can leave a shifted hour behind when
    // the final landed day itself is a DST transition day (see dueTimeStr).
    const typedTimeStr = hasTime ? formatTimeHHmm(due) : undefined;
    if (repeat.type === 'PRESET' && repeat.quickSetting === 'MONDAY_TO_FRIDAY') {
      skipExcludedWeekend(due);
    }
    return {
      changes: {
        dueWithTime: due.getTime(),
        dueDay: null,
        ...(hasTime ? { dueTimeStr: typedTimeStr } : { hasPlannedTime: false }),
      },
      repeat,
      ranges,
    };
  }

  return { changes: {}, repeat, ranges };
};

const parseScheduledDate = (
  tracked: TrackedTitle,
  now: Date,
  isParseRepeat: boolean = false,
): Promise<DateStageResult | null> =>
  parseShortSyntaxDate(tracked, now, SHORT_SYNTAX_DUE_REG_EX, false, isParseRepeat);

const parseDeadlineDate = (
  tracked: TrackedTitle,
  now: Date,
): Promise<DateStageResult | null> =>
  parseShortSyntaxDate(tracked, now, SHORT_SYNTAX_DEADLINE_REG_EX, true);

const parseTimeSpentTracked = (
  task: Partial<TaskCopy>,
  tracked: TrackedTitle,
): { changes: Partial<Task>; ranges: TextRange[] } | null => {
  if (!tracked.text) {
    return null;
  }

  const matches = SHORT_SYNTAX_TIME_REG_EX.exec(tracked.text);
  if (!matches) {
    return null;
  }

  const [matchSpan, preSplit, postSplit] = matches;
  const start = matches.index;
  const ranges = tracked.rawRanges(start, start + matchSpan.length);
  tracked.remove(start, start + matchSpan.length);
  tracked.trim();
  const timeSpent = matchSpan.includes(CH_TSP) ? preSplit : null;
  const timeEstimate = timeSpent === null ? preSplit : postSplit;

  return {
    changes: {
      ...(typeof timeSpent === 'string' && {
        timeSpentOnDay: {
          ...task.timeSpentOnDay,
          [getDbDateStr()]: timeSpent
            .split(/\s+/g)
            .reduce((ms, s) => ms + stringToMs(s), 0),
        },
      }),
      ...(typeof timeEstimate === 'string' && {
        timeEstimate: timeEstimate.split(/\s+/g).reduce((ms, s) => ms + stringToMs(s), 0),
      }),
    },
    ranges,
  };
};

export const parseTimeSpentChanges = (task: Partial<TaskCopy>): Partial<Task> => {
  if (!task.title) {
    return {};
  }
  const tracked = new TrackedTitle(task.title);
  const result = parseTimeSpentTracked(task, tracked);
  return result ? { ...result.changes, title: tracked.text } : {};
};

/**
 * Collapses every markdown link `[text](url)` in `tracked` down to its display
 * text (dropping the '[' and the '](url)') and returns the URLs found plus the
 * raw positions of the dropped characters.
 *
 * This is the single definition of "what markdown removal does": the plain-URL
 * scan reads `tracked.text` *after* this ran, so the text it searches can never
 * drift from the text the tracker actually holds.
 *
 * A match with an empty destination — `[text]()` — is left alone: it yields no
 * URL, so extracting it would delete the user's characters without producing an
 * attachment in return. Skipping it here is what makes that rule unconditional;
 * the caller only reaches this function when *some* URL exists in the title, so
 * collapsing every match would have let an unrelated URL elsewhere decide
 * whether `[text]()` survived.
 */
const collapseMarkdownLinks = (
  tracked: TrackedTitle,
): { urls: string[]; ranges: TextRange[] } => {
  if (!tracked.text.includes('](')) {
    return { urls: [], ranges: [] };
  }
  const urls: string[] = [];
  const ranges: TextRange[] = [];
  // Right-to-left so earlier removals don't shift later match positions; both
  // lists are built back to front to end up in reading order.
  const matches = [...tracked.text.matchAll(SHORT_SYNTAX_MARKDOWN_LINK_REG_EX)];
  for (const m of matches.reverse()) {
    const start = m.index as number;
    const displayText = m[1];
    const url = m[2];
    if (!url) {
      continue;
    }
    urls.unshift(url);
    const tailStart = start + 1 + displayText.length;
    const tailEnd = start + m[0].length;
    ranges.unshift(...tracked.rawRanges(tailStart, tailEnd));
    tracked.remove(tailStart, tailEnd);
    ranges.unshift(...tracked.rawRanges(start, start + 1));
    tracked.remove(start, start + 1);
  }
  return { urls, ranges };
};

const parseUrlAttachments = (
  task: Partial<TaskCopy>,
  tracked: TrackedTitle,
  config: ShortSyntaxConfig,
):
  | {
      attachments: TaskAttachment[];
      title: string;
      ranges: TextRange[];
    }
  | undefined => {
  if (!tracked.text || task.issueId) {
    return undefined;
  }

  const titleBefore = tracked.text;

  // 1. Collapse markdown links first — they take priority over plain URL
  // matching, which would otherwise greedily include the closing ')' of
  // markdown syntax like [text](https://example.com/).
  // 2. Then match the remaining plain URLs in what is left.
  // Both run on a scratch tracker: nothing may be removed from the real title
  // until we know there is a URL to extract.
  const scratch = new TrackedTitle(titleBefore);
  const { urls: markdownUrls } = collapseMarkdownLinks(scratch);
  const plainUrlMatches = scratch.text.match(SHORT_SYNTAX_URL_REG_EX) || [];

  const allUrls = [...markdownUrls, ...plainUrlMatches];
  if (allUrls.length === 0) {
    return undefined;
  }

  // Handle 'keep' mode: no changes, URL stays in title, no attachment
  // Default to 'keep' if urlBehavior is undefined
  if (!config.urlBehavior || config.urlBehavior === 'keep') {
    return undefined;
  }

  // Filter out attachments that already exist (prevent duplicates)
  const newAttachments = filterDuplicateUrlAttachments(allUrls, task.attachments || []);

  const ranges: TextRange[] = [];
  let cleanedTitle = titleBefore;
  if (config.urlBehavior === 'extract') {
    // In extract mode: replace markdown links with display text, remove plain
    // URLs. The same collapse the scratch tracker ran, now on the real one, so
    // the '[' and '](url)' it drops are highlighted like any other stripped
    // token.
    ranges.push(...collapseMarkdownLinks(tracked).ranges);
    // Remove every occurrence of each plain URL (normalized the same way the
    // attachment path is: trimmed, trailing punctuation stripped)
    for (const url of plainUrlMatches) {
      let path = url.trim().replace(/[.,;!?]+$/, '');
      if (!path.match(/^(?:https?|file):\/\//)) {
        path = '//' + path;
      }
      const originalUrl = path.startsWith('//') ? path.substring(2) : path;
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const spans = [...tracked.text.matchAll(new RegExp(escapedUrl, 'g'))].map((m) => ({
        start: m.index as number,
        end: (m.index as number) + m[0].length,
      }));
      for (const span of spans.reverse()) {
        ranges.push(...tracked.rawRanges(span.start, span.end));
        tracked.remove(span.start, span.end);
      }
    }
    tracked.collapseWhitespace();
    cleanedTitle = tracked.text;

    // If the title is empty after extracting URLs, use a URL basename as
    // the task name so pasting a bare URL results in a meaningful title.
    // Use allUrls (not newAttachments) because the pasted URL may already
    // exist as an attachment, in which case newAttachments would be empty.
    if (!cleanedTitle && allUrls.length > 0) {
      cleanedTitle = _baseNameForUrl(allUrls[0]) || cleanedTitle;
    }
  }

  // Return undefined if nothing changed
  const titleChanged = cleanedTitle !== titleBefore;
  const hasNewAttachments = newAttachments.length > 0;

  if (!titleChanged && !hasNewAttachments) {
    return undefined;
  }

  return {
    attachments: newAttachments,
    title: cleanedTitle,
    // Only URLs actually removed from the title are reported for highlighting
    ranges: titleChanged ? ranges : [],
  };
};

const createUrlAttachment = (url: string): TaskAttachment => {
  let path = url.trim();

  // Remove trailing punctuation that's not part of the URL
  path = path.replace(/[.,;!?]+$/, '');

  const isFileProtocol = path.startsWith('file://');

  // Add protocol if missing (for www. URLs)
  if (!path.match(/^(?:https?|file):\/\//)) {
    path = '//' + path;
  }

  // Detect if it's an image
  const isImage = isImageUrlSimple(path);

  // Determine type and icon
  let type: 'FILE' | 'LINK' | 'IMG';
  let icon: string;

  if (isImage) {
    type = 'IMG';
    icon = 'image';
  } else if (isFileProtocol) {
    type = 'FILE';
    icon = 'insert_drive_file';
  } else {
    type = 'LINK';
    icon = 'bookmark';
  }

  return {
    id: nanoid(),
    type,
    path,
    title: _baseNameForUrl(path),
    icon,
  };
};

const filterDuplicateUrlAttachments = (
  urlMatches: string[],
  existingAttachments: TaskAttachment[],
): TaskAttachment[] => {
  const existingPaths = new Set(
    existingAttachments.map((a) => a.path).filter((p): p is string => !!p),
  );

  return urlMatches
    .map((url) => createUrlAttachment(url))
    .filter((attachment) => attachment.path && !existingPaths.has(attachment.path));
};

const _baseNameForUrl = (passedStr: string): string => {
  const str = passedStr.trim();
  let base;
  if (str[str.length - 1] === '/') {
    const strippedStr = str.substring(0, str.length - 1);
    base = strippedStr.substring(strippedStr.lastIndexOf('/') + 1);
  } else {
    base = str.substring(str.lastIndexOf('/') + 1);
  }

  if (base.lastIndexOf('.') !== -1) {
    base = base.substring(0, base.lastIndexOf('.'));
  }
  return base;
};
