import { Task, TaskCopy } from './task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { stringToMs } from '../../ui/duration/string-to-ms.pipe';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';
import { Section } from '../section/section.model';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { isImageUrlSimple } from '../../util/is-image-url';
import { TaskAttachment } from './task-attachment/task-attachment.model';
import { nanoid } from 'nanoid';
import type { Chrono, ParsingContext, ParsingResult } from 'chrono-node';
type ProjectChanges = {
  title?: string;
  projectId?: string;
  sectionId?: string;
};
type TagChanges = {
  taskChanges?: Partial<TaskCopy>;
  newTagTitlesToCreate?: string[];
};

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
// Separates the section from the project inside a "+Project/Section" token.
const CH_SECTION = '/';
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
  allSections?: Section[],
  // The project the task will land in when no "+Project" token is typed —
  // the context a standalone "/Section" token resolves against.
  contextProjectId?: string,
): Promise<
  | {
      taskChanges: Partial<Task> & { hasDeadlineTime?: boolean };
      newTagTitles: string[];
      remindAt: number | null;
      projectId: string | undefined;
      sectionId?: string;
      attachments: TaskAttachment[];
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

  if (config.isEnableDue) {
    taskChanges = parseTimeSpentChanges(task);
    const dueChanges = await parseScheduledDate(
      { ...task, title: taskChanges.title || task.title },
      now,
    );
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
      allSections,
    );
    if (changesForProject.projectId) {
      taskChanges = {
        ...taskChanges,
        title: changesForProject.title,
      };
    }

    // Standalone "/Section" (no "+Project" token): resolve against the
    // project the task is being added to (an explicit "+Project" wins).
    if (!changesForProject.sectionId) {
      const sectionContextProjectId = changesForProject.projectId || contextProjectId;
      if (sectionContextProjectId) {
        const standaloneSection = parseStandaloneSectionChanges(
          { ...task, title: taskChanges.title || task.title },
          sectionContextProjectId,
          allSections,
        );
        if (standaloneSection.sectionId) {
          changesForProject = {
            ...changesForProject,
            sectionId: standaloneSection.sectionId,
          };
          taskChanges = {
            ...taskChanges,
            title: standaloneSection.title,
          };
        }
      }
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
    ...(changesForProject.sectionId ? { sectionId: changesForProject.sectionId } : {}),
    attachments,
    // remindAt: changesForDue.remindAt
  };
};

// Prefix-match typed text against a project's sections; falls back to first
// word only (like project matching). Returns the exact typed text to strip
// from the title alongside the id.
const matchSectionByTypedText = (
  typed: string,
  projectId: string,
  allSections?: Section[],
): { sectionId: string; typedText: string } | undefined => {
  if (!typed.trim() || !Array.isArray(allSections) || !allSections.length) {
    return undefined;
  }
  const projectSections = allSections
    .filter((s) => s.contextId === projectId)
    .sort((s1, s2) => s1.title.length - s2.title.length);
  const attempts = [typed.trim(), typed.trim().split(' ')[0]];
  for (const typedText of attempts) {
    const toMatch = typedText.replaceAll(' ', '').toLowerCase();
    const existing = projectSections.find(
      (s) => s.title.replaceAll(' ', '').toLowerCase().indexOf(toMatch) === 0,
    );
    if (existing) {
      return { sectionId: existing.id, typedText };
    }
  }
  return undefined;
};

// Standalone "/Section" token (word boundary before "/", no space after it) —
// only meaningful when a context project is known. Nothing is stripped from
// the title unless a section actually matches, so slashes in ordinary prose
// ("either/or", "w/ milk") and URLs stay untouched.
const SHORT_SYNTAX_STANDALONE_SECTION_REG_EX = new RegExp(
  `(?:^|\\s)\\${CH_SECTION}(?!\\s|\\${CH_SECTION})([^${ALL_SPECIAL}]+)`,
);

export const parseStandaloneSectionChanges = (
  task: Partial<TaskCopy>,
  contextProjectId: string,
  allSections?: Section[],
): { title?: string; sectionId?: string } => {
  if (!task.title || !contextProjectId) {
    return {};
  }
  const rr = task.title.match(SHORT_SYNTAX_STANDALONE_SECTION_REG_EX);
  if (!rr || !rr[1]) {
    return {};
  }
  const section = matchSectionByTypedText(rr[1], contextProjectId, allSections);
  if (!section) {
    return {};
  }
  // Positional strip of exactly the matched "/<typed>" span (see the same
  // pattern in parseProjectChanges — reconstructed-string .replace() is
  // fragile against earlier lookalike substrings).
  const slashPos =
    (rr.index as number) + (rr[0].startsWith(CH_SECTION) ? 0 : rr[0].search(/\//));
  const stripLen = 1 + section.typedText.length;
  return {
    title: (task.title.slice(0, slashPos) + task.title.slice(slashPos + stripLen))
      .trim()
      .replace('  ', ' '),
    sectionId: section.sectionId,
  };
};

export const parseProjectChanges = (
  task: Partial<TaskCopy>,
  allProjects?: Project[],
  allSections?: Section[],
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
    const rawToken: string = rr[0].trim().replace(CH_PRO, '');
    // "+Project/Section" targets a section within the matched project;
    // everything after the first "/" is the section part.
    const slashIndex = rawToken.indexOf(CH_SECTION);
    const projectTitle = slashIndex === -1 ? rawToken : rawToken.slice(0, slashIndex);
    const sectionPart = slashIndex === -1 ? '' : rawToken.slice(slashIndex + 1);

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

    const matchProject = (titleToMatch: string): Project | undefined =>
      sortedAllProjects.find(
        (project) =>
          project.title.replaceAll(' ', '').toLowerCase().indexOf(titleToMatch) === 0,
      );

    // Positional strip: remove exactly `len` chars of the matched token
    // starting at the "+" — never reconstruct the typed text by string
    // concatenation (a `.replace()` on a rebuilt string silently no-ops when
    // the rebuild doesn't byte-match the input, orphaning syntax in the title).
    const tokenStart = rr.index as number;
    const stripAt = (len: number): string =>
      (
        (task.title as string).slice(0, tokenStart) +
        (task.title as string).slice(tokenStart + len)
      )
        .trim()
        .replace('  ', ' ');

    const buildResult = (project: Project, typedProjectText: string): ProjectChanges => {
      // Sections are only resolved when the FULL left side matched the
      // project — after a first-word-only match the leftover words sit
      // between the project and the "/", so a contiguous strip is impossible.
      const isFullLeftMatch = typedProjectText === projectTitle;
      const section =
        slashIndex !== -1 && isFullLeftMatch
          ? matchSectionByTypedText(sectionPart, project.id, allSections)
          : undefined;

      let stripLen: number;
      if (section) {
        // "+Work/Design …" → strip through the matched section text
        const leadingWs = sectionPart.length - sectionPart.trimStart().length;
        stripLen = 1 + projectTitle.length + 1 + leadingWs + section.typedText.length;
      } else if (slashIndex !== -1 && isFullLeftMatch) {
        // "+Work/grocer" with no matching section: strip through the slash so
        // the leftover ("grocer") rejoins the title instead of keeping a
        // stray "/" (review finding on PR #9014).
        stripLen = 1 + projectTitle.length + 1;
      } else {
        stripLen = 1 + typedProjectText.length;
      }

      return {
        title: stripAt(stripLen),
        projectId: project.id,
        ...(section ? { sectionId: section.sectionId } : {}),
      };
    };

    // Legacy first: the whole token as a project title, so projects whose
    // titles themselves contain "/" (e.g. "A/B Testing") keep matching and
    // never get misread as project/section.
    if (slashIndex !== -1) {
      const wholeTokenProject = matchProject(rawToken.replaceAll(' ', '').toLowerCase());
      if (wholeTokenProject) {
        return {
          title: stripAt(1 + rawToken.length),
          projectId: wholeTokenProject.id,
        };
      }
    }

    const existingProject = matchProject(projectTitleToMatch);
    if (existingProject) {
      return buildResult(existingProject, projectTitle);
    }

    // also try only first word after special char
    const projectTitleFirstWordOnly = projectTitle.split(' ')[0];
    const projectTitleToMatch2 = projectTitleFirstWordOnly.replace(' ', '').toLowerCase();
    const existingProjectForFirstWordOnly = matchProject(projectTitleToMatch2);

    if (existingProjectForFirstWordOnly) {
      return buildResult(existingProjectForFirstWordOnly, projectTitleFirstWordOnly);
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
): Promise<Partial<TaskCopy> & { hasDeadlineTime?: boolean }> => {
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

const parseScheduledDate = (
  task: Partial<TaskCopy>,
  now: Date,
): Promise<Partial<TaskCopy> & { hasDeadlineTime?: boolean }> =>
  parseShortSyntaxDate(task, now, SHORT_SYNTAX_DUE_REG_EX, false);

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
