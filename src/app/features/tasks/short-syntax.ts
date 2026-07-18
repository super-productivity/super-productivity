import { Task, TaskCopy } from './task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { stringToMs } from '../../ui/duration/string-to-ms.pipe';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { isImageUrlSimple } from '../../util/is-image-url';
import { TaskAttachment } from './task-attachment/task-attachment.model';
import { nanoid } from 'nanoid';
import type { Chrono, ParsingContext, ParsingResult } from 'chrono-node';
import { RepeatQuickSetting } from '../task-repeat-cfg/task-repeat-cfg.model';
type ProjectChanges = {
  title?: string;
  projectId?: string;
};
type TagChanges = {
  taskChanges?: Partial<TaskCopy>;
  newTagTitlesToCreate?: string[];
};

export interface ShortSyntaxRepeatCfg {
  quickSetting: RepeatQuickSetting;
  repeatEvery: number;
}

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

// Recurrence phrase at the start of a due match: either a bare frequency word
// ("@daily") or an "every ..." phrase ("@every friday", "@every 2 weeks",
// "@every 15th"). Anchored to the start so "@some day every year" is parsed as
// a plain date, not a recurrence. The phrase may be followed by whitespace,
// end-of-input, or trailing punctuation ("water plants @every friday.") —
// chrono is equally punctuation-tolerant for plain dates, so without this the
// dot would demote the whole phrase to a plain "friday" date.
export const SHORT_SYNTAX_REPEAT_REG_EX = new RegExp(
  '^(?:(daily|weekly|monthly|yearly|annually)' +
    '|every(?:\\s+(\\d{1,3}))?\\s+(' +
    'days?|weeks?|months?|years?|weekdays?|workdays?' +
    '|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?' +
    '|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun' +
    '|\\d{1,2}(?:st|nd|rd|th)' +
    '))(?=[\\s.,;:!?]|$)',
  'i',
);

interface RepeatSyntaxResult {
  repeatCfg: ShortSyntaxRepeatCfg;
  // Remainder after the recurrence phrase, run through chrono for an optional
  // time ("3pm" in "@every friday 3pm")
  chronoText: string;
  // Chars of the due match consumed by the recurrence phrase itself
  consumedLength: number;
  // Anchor for the first occurrence; chrono never sees the unit word
  weekday?: number;
  dayOfMonth?: number;
}

const parseRepeatSyntax = (dueMatchContent: string): RepeatSyntaxResult | null => {
  const m = dueMatchContent.match(SHORT_SYNTAX_REPEAT_REG_EX);
  if (!m) {
    return null;
  }
  const bareWord = m[1]?.toLowerCase();
  const repeatEvery = m[2] ? Math.max(1, +m[2]) : 1;
  const unit = m[3]?.toLowerCase();
  const remainder = dueMatchContent.slice(m[0].length);

  const result = (
    quickSetting: RepeatQuickSetting,
    anchor?: { weekday?: number; dayOfMonth?: number },
  ): RepeatSyntaxResult => ({
    repeatCfg: { quickSetting, repeatEvery },
    chronoText: remainder,
    consumedLength: m[0].length,
    ...anchor,
  });

  if (bareWord) {
    switch (bareWord) {
      case 'daily':
        return result('DAILY');
      case 'weekly':
        return result('WEEKLY_CURRENT_WEEKDAY');
      case 'monthly':
        return result('MONTHLY_CURRENT_DATE');
      default:
        // yearly | annually
        return result('YEARLY_CURRENT_DATE');
    }
  }

  const weekday = WEEKDAY_UNITS[unit] ?? WEEKDAY_UNITS[unit.replace(/s$/, '')];
  if (weekday !== undefined) {
    return result('WEEKLY_CURRENT_WEEKDAY', { weekday });
  }

  const ordinalMatch = unit.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
  if (ordinalMatch) {
    const dayOfMonth = +ordinalMatch[1];
    if (dayOfMonth < 1 || dayOfMonth > 31) {
      return null;
    }
    return result('MONTHLY_CURRENT_DATE', { dayOfMonth });
  }

  if (unit.startsWith('weekday') || unit.startsWith('workday')) {
    return result('MONDAY_TO_FRIDAY');
  }
  if (unit.startsWith('day')) {
    return result('DAILY');
  }
  if (unit.startsWith('week')) {
    return result('WEEKLY_CURRENT_WEEKDAY');
  }
  if (unit.startsWith('month')) {
    return result('MONTHLY_CURRENT_DATE');
  }
  // year(s)
  return result('YEARLY_CURRENT_DATE');
};

// Next date falling on the given weekday, today or later, at 12:00 (mirrors
// chrono's implied-time default so the downstream dueDay conversion matches)
const getNextWeekdayDate = (now: Date, weekday: number): Date => {
  const diff = (weekday - now.getDay() + 7) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 12, 0);
};

// Next date with the given day-of-month, today or later; months without that
// day (e.g. "every 31st" in February) are skipped, matching how the monthly
// repeat engine clamps occurrences.
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
      taskChanges: Partial<Task> & { hasDeadlineTime?: boolean };
      newTagTitles: string[];
      remindAt: number | null;
      projectId: string | undefined;
      attachments: TaskAttachment[];
      repeatCfg: ShortSyntaxRepeatCfg | null;
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
  let taskChanges: Partial<TaskCopy> & { hasDeadlineTime?: boolean } = {};
  let changesForProject: ProjectChanges = {};
  let changesForTag: TagChanges = {};
  let attachments: TaskAttachment[] = [];
  let repeatCfg: ShortSyntaxRepeatCfg | null = null;

  if (config.isEnableDue) {
    taskChanges = parseTimeSpentChanges(task);
    const { repeatCfg: parsedRepeatCfg, ...dueChanges } = await parseScheduledDate(
      { ...task, title: taskChanges.title || task.title },
      now,
      isParseRepeat,
    );
    repeatCfg = parsedRepeatCfg || null;
    const deadlineChanges = await parseDeadlineDate(
      { ...task, title: dueChanges.title ?? (taskChanges.title || task.title) },
      now,
    );
    taskChanges = { ...taskChanges, ...dueChanges, ...deadlineChanges };
  }

  if (config.isEnableProject) {
    changesForProject = parseProjectChanges(
      { ...task, title: taskChanges.title || task.title },
      allProjects?.filter((p) => !p.isArchived && !p.isHiddenFromMenu),
    );
    if (changesForProject.projectId) {
      taskChanges = {
        ...taskChanges,
        title: changesForProject.title,
      };
    }
  }

  if (config.isEnableTag) {
    changesForTag = parseTagChanges(
      { ...task, title: taskChanges.title || task.title },
      allTags,
      mode,
    );
    taskChanges = {
      ...taskChanges,
      ...(changesForTag.taskChanges || {}),
    };
  }

  const urlChanges = parseUrlAttachments(
    {
      ...task,
      title: taskChanges.title || task.title,
    },
    config,
  );
  if (urlChanges) {
    if (urlChanges.attachments.length > 0) {
      attachments = urlChanges.attachments;
    }
    taskChanges = {
      ...taskChanges,
      title: urlChanges.title,
    };
  }

  // const changesForDue = parseDueChanges({...task, title: taskChanges.title || task.title});
  // if (changesForDue.remindAt) {
  //   taskChanges = {
  //     ...taskChanges,
  //     title: changesForDue.title,
  //   };
  // }

  if (Object.keys(taskChanges).length === 0 && attachments.length === 0) {
    return undefined;
  }

  return {
    taskChanges,
    newTagTitles: changesForTag.newTagTitlesToCreate || [],
    remindAt: null,
    projectId: changesForProject.projectId,
    attachments,
    repeatCfg,
    // remindAt: changesForDue.remindAt
  };
};

export const parseProjectChanges = (
  task: Partial<TaskCopy>,
  allProjects?: Project[],
): ProjectChanges => {
  if (
    task.issueId || // don't allow for issue tasks
    !task.title ||
    !Array.isArray(allProjects) ||
    !allProjects ||
    allProjects.length === 0
  ) {
    return {};
  }

  const rr = task.title.match(SHORT_SYNTAX_PROJECT_REG_EX);

  if (rr && rr[0]) {
    const projectTitle: string = rr[0].trim().replace(CH_PRO, '');
    const projectTitleToMatch = projectTitle.replaceAll(' ', '').toLowerCase();
    const indexBeforePlus =
      task.title.toLowerCase().lastIndexOf(CH_PRO + projectTitleToMatch) - 1;
    const charBeforePlus = task.title.charAt(indexBeforePlus);

    // don't parse Fun title+blu as project
    if (charBeforePlus && charBeforePlus !== ' ') {
      return {};
    }

    // Prefer shortest prefix-based project title match
    const sortedAllProjects = allProjects
      .slice()
      .sort((p1, p2) => p1.title.length - p2.title.length);

    const existingProject = sortedAllProjects.find(
      (project) =>
        project.title.replaceAll(' ', '').toLowerCase().indexOf(projectTitleToMatch) ===
        0,
    );

    if (existingProject) {
      return {
        title: task.title
          ?.replace(`${CH_PRO}${projectTitle}`, '')
          .trim()
          .replace('  ', ' '),
        projectId: existingProject.id,
      };
    }

    // also try only first word after special char
    const projectTitleFirstWordOnly = projectTitle.split(' ')[0];
    const projectTitleToMatch2 = projectTitleFirstWordOnly.replace(' ', '').toLowerCase();
    const existingProjectForFirstWordOnly = sortedAllProjects.find(
      (project) =>
        project.title.replaceAll(' ', '').toLowerCase().indexOf(projectTitleToMatch2) ===
        0,
    );

    if (existingProjectForFirstWordOnly) {
      return {
        title: task.title
          ?.replace(`${CH_PRO}${projectTitleFirstWordOnly}`, '')
          .trim()
          // get rid of excess whitespaces
          .replace('  ', ' '),
        projectId: existingProjectForFirstWordOnly.id,
      };
    }
  }

  return {};
};

const parseTagChanges = (
  task: Partial<TaskCopy>,
  allTags?: Tag[],
  mode: 'combine' | 'replace' = 'combine',
): TagChanges => {
  const taskChanges: Partial<TaskCopy> = {};

  const newTagTitlesToCreate: string[] = [];
  // only exec if previous ones are also passed
  if (Array.isArray(task.tagIds) && Array.isArray(allTags)) {
    const initialTitle = task.title as string;
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

      if (
        newTagTitlesToCreate.length ||
        taskChanges.tagIds?.length ||
        regexTagTitlesTrimmedAndFiltered.length
      ) {
        taskChanges.title = initialTitle;
        regexTagTitlesTrimmedAndFiltered.forEach((tagTitle) => {
          taskChanges.title = taskChanges.title?.replace(`#${tagTitle}`, '');
        });
        taskChanges.title = taskChanges.title.trim();
      }

      // TaskLog.log(task.title);
      // TaskLog.log('newTagTitles', regexTagTitles);
      // TaskLog.log('newTagTitlesTrimmed', regexTagTitlesTrimmedAndFiltered);
      // TaskLog.log('allTags)', allTags.map(tag => `${tag.id}: ${tag.title}`));
      // TaskLog.log('task.tagIds', task.tagIds);
      // TaskLog.log('task.title', task.title);
    }
  }
  // TaskLog.log(taskChanges);

  return {
    taskChanges,
    newTagTitlesToCreate,
  };
};

const parseShortSyntaxDate = async (
  task: Partial<TaskCopy>,
  now: Date,
  regEx: RegExp,
  isDeadline: boolean,
  isParseRepeat: boolean = false,
): Promise<
  Partial<TaskCopy> & { hasDeadlineTime?: boolean; repeatCfg?: ShortSyntaxRepeatCfg }
> => {
  if (!task.title) {
    return {};
  }
  const rr = task.title.match(regEx);

  if (rr && rr[0]) {
    if (isDeadline) {
      // Check if the character before trigger is a space or start of string
      const indexBeforeTrigger = task.title.indexOf(rr[0]) - 1;
      const charBeforeTrigger =
        indexBeforeTrigger >= 0 ? task.title.charAt(indexBeforeTrigger) : '';
      if (charBeforeTrigger && charBeforeTrigger !== ' ') {
        return {};
      }
    }

    if (!isDeadline && isParseRepeat) {
      const repeatResult = parseRepeatSyntax(rr[0].substring(1));
      if (repeatResult) {
        return await applyRepeatSyntax(task, now, rr[0], repeatResult);
      }
    }

    const dateParser = await loadCustomDateParser();
    const parsedDateArr = dateParser.parse(rr[0], now, {
      forwardDate: true,
    });

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
      // Strip out the short syntax for scheduled date and given date
      const title = task.title.replace(textToReplace, '').trim();

      if (isDeadline) {
        return {
          deadlineWithTime: due,
          deadlineDay: null,
          title,
          ...(hasPlannedTime ? { hasDeadlineTime: true } : { hasDeadlineTime: false }),
        };
      } else {
        return {
          dueWithTime: due,
          dueDay: null,
          title,
          ...(hasPlannedTime ? {} : { hasPlannedTime: false }),
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
        const title = task.title.replace(textToReplace, '').trim();

        if (isDeadline) {
          return {
            deadlineWithTime: due.getTime(),
            deadlineDay: null,
            title,
          };
        } else {
          return {
            dueWithTime: due.getTime(),
            dueDay: null,
            title,
          };
        }
      }
    }
  }

  return {};
};

// Resolves a matched recurrence phrase into task changes: the quick-setting
// repeat cfg plus an optional anchor date/time parsed from what follows the
// phrase ("@every friday 3pm" → next Friday 15:00), with the consumed syntax
// stripped from the title.
const applyRepeatSyntax = async (
  task: Partial<TaskCopy>,
  now: Date,
  dueMatch: string,
  repeatResult: RepeatSyntaxResult,
): Promise<Partial<TaskCopy> & { repeatCfg?: ShortSyntaxRepeatCfg }> => {
  const { repeatCfg, chronoText, consumedLength, weekday, dayOfMonth } = repeatResult;
  const dateParser = await loadCustomDateParser();
  const parsedDateArr = chronoText
    ? dateParser.parse(chronoText, now, { forwardDate: true })
    : [];
  const parsedDateResult = parsedDateArr.length ? parsedDateArr[0] : null;
  // Chars of the due match consumed in total (incl. the trigger char) — the
  // recurrence phrase itself plus whatever chrono matched of the remainder
  const consumedTotal =
    1 +
    consumedLength +
    (parsedDateResult ? parsedDateResult.index + parsedDateResult.text.length : 0);
  const textToReplace = dueMatch.substring(0, consumedTotal);
  const title = (task.title as string).replace(textToReplace, '').trim();
  const hasTime = !!parsedDateResult && parsedDateResult.start.isCertain('hour');

  const anchorDate =
    weekday !== undefined
      ? getNextWeekdayDate(now, weekday)
      : dayOfMonth !== undefined
        ? getNextDayOfMonthDate(now, dayOfMonth)
        : null;

  if (anchorDate) {
    if (hasTime && parsedDateResult) {
      const parsed = parsedDateResult.start.date();
      anchorDate.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
    }
    return {
      dueWithTime: anchorDate.getTime(),
      dueDay: null,
      title,
      repeatCfg,
      ...(hasTime ? {} : { hasPlannedTime: false }),
    };
  }

  if (parsedDateResult) {
    return {
      dueWithTime: parsedDateResult.start.date().getTime(),
      dueDay: null,
      title,
      repeatCfg,
      ...(hasTime ? {} : { hasPlannedTime: false }),
    };
  }

  return { title, repeatCfg };
};

const parseScheduledDate = (
  task: Partial<TaskCopy>,
  now: Date,
  isParseRepeat: boolean = false,
): Promise<
  Partial<TaskCopy> & { hasDeadlineTime?: boolean; repeatCfg?: ShortSyntaxRepeatCfg }
> => parseShortSyntaxDate(task, now, SHORT_SYNTAX_DUE_REG_EX, false, isParseRepeat);

const parseDeadlineDate = (
  task: Partial<TaskCopy>,
  now: Date,
): Promise<Partial<TaskCopy> & { hasDeadlineTime?: boolean }> =>
  parseShortSyntaxDate(task, now, SHORT_SYNTAX_DEADLINE_REG_EX, true);

export const parseTimeSpentChanges = (task: Partial<TaskCopy>): Partial<Task> => {
  if (!task.title) {
    return {};
  }

  const matches = SHORT_SYNTAX_TIME_REG_EX.exec(task.title);
  if (!matches) {
    return {};
  }

  const [matchSpan, preSplit, postSplit] = matches;
  const timeSpent = matchSpan.includes(CH_TSP) ? preSplit : null;
  const timeEstimate = timeSpent === null ? preSplit : postSplit;

  return {
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
    title: task.title.replace(matchSpan, '').trim(),
  };
};

/**
 * Extracts markdown links [text](url) from title.
 * Returns the URLs found and a title with markdown links replaced by their display text.
 */
const extractMarkdownLinks = (
  title: string,
): { urls: string[]; titleWithoutMarkdown: string } => {
  if (!title.includes('](')) {
    return { urls: [], titleWithoutMarkdown: title };
  }
  const urls: string[] = [];
  const titleWithoutMarkdown = title.replace(
    SHORT_SYNTAX_MARKDOWN_LINK_REG_EX,
    (_match, text: string, url: string) => {
      if (url) {
        urls.push(url);
      }
      return text;
    },
  );
  return { urls, titleWithoutMarkdown };
};

const parseUrlAttachments = (
  task: Partial<TaskCopy>,
  config: ShortSyntaxConfig,
):
  | {
      attachments: TaskAttachment[];
      title: string;
    }
  | undefined => {
  if (!task.title || task.issueId) {
    return undefined;
  }

  // 1. Extract markdown links first — they take priority over plain URL matching
  // This prevents the plain URL regex from greedily including the closing ')' of
  // markdown syntax like [text](https://example.com/)
  const { urls: markdownUrls, titleWithoutMarkdown } = extractMarkdownLinks(task.title);

  // 2. Then match remaining plain URLs in the title (after markdown links are replaced)
  const plainUrlMatches = titleWithoutMarkdown.match(SHORT_SYNTAX_URL_REG_EX) || [];

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

  let cleanedTitle = task.title;
  if (config.urlBehavior === 'extract') {
    // In extract mode: replace markdown links with display text, remove plain URLs
    cleanedTitle = markdownUrls.length > 0 ? titleWithoutMarkdown : task.title;
    cleanedTitle = removeUrlsFromTitle(cleanedTitle, plainUrlMatches);

    // If the title is empty after extracting URLs, use a URL basename as
    // the task name so pasting a bare URL results in a meaningful title.
    // Use allUrls (not newAttachments) because the pasted URL may already
    // exist as an attachment, in which case newAttachments would be empty.
    if (!cleanedTitle && allUrls.length > 0) {
      cleanedTitle = _baseNameForUrl(allUrls[0]) || cleanedTitle;
    }
  }

  // Return undefined if nothing changed
  const titleChanged = cleanedTitle !== task.title;
  const hasNewAttachments = newAttachments.length > 0;

  if (!titleChanged && !hasNewAttachments) {
    return undefined;
  }

  return {
    attachments: newAttachments,
    title: cleanedTitle,
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

const removeUrlsFromTitle = (title: string, urlMatches: string[]): string => {
  let cleanedTitle = title;

  // Clean URLs from title - process all URL matches
  // We need to remove URLs even if they already exist as attachments
  urlMatches.forEach((url) => {
    let path = url.trim().replace(/[.,;!?]+$/, '');

    // Add protocol if missing (for www. URLs)
    if (!path.match(/^(?:https?|file):\/\//)) {
      path = '//' + path;
    }

    // For www URLs, the path has '//' prepended, but the original doesn't
    const originalUrl = path.startsWith('//') ? path.substring(2) : path;

    // Escape special regex characters for safe replacement
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleanedTitle = cleanedTitle.replace(new RegExp(escapedUrl, 'g'), '');
  });

  return cleanedTitle.trim().replace(/\s+/g, ' ');
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
