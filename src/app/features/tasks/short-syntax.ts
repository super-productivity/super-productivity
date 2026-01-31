import { Task, TaskCopy } from './task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { stringToMs } from '../../ui/duration/string-to-ms.pipe';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';
import { ShortSyntaxConfig } from '../config/global-config.model';
import { isImageUrlSimple } from '../../util/is-image-url';
import { TaskAttachment } from './task-attachment/task-attachment.model';
import { nanoid } from 'nanoid';
type ProjectChanges = {
  title?: string;
  projectId?: string;
};
type TagChanges = {
  taskChanges?: Partial<TaskCopy>;
  newTagTitlesToCreate?: string[];
};
type DueChanges = {
  title?: string;
  dueWithTime?: number;
  dueDay?: string | null;
};

const CH_TSP = '/';
// Due how this expression capture clusters of duration units, be mindful of
// match boundary whitespace during processing
export const SHORT_SYNTAX_TIME_REG_EX = new RegExp(
  String.raw`(?:\s|^)t?((?:\d+(?:\.\d+)?[mhd]\s*)+)(?:\s*` +
    `\\${CH_TSP}` +
    String.raw`((?:\s*\d+(?:\.\d+)?[mhd])+)?)?(?=\s|$)`,
  'i',
);

const CH_PRO = '+';
const CH_TAG = '#';
const CH_DUE = '@';
const ALL_SPECIAL = `(\\${CH_PRO}|\\${CH_TAG}|\\${CH_DUE})`;

let customDateParserPromise: Promise<any> | null = null;
let customDateParserCache: any = null;

const loadCustomDateParser = (): Promise<any> => {
  if (customDateParserCache) {
    return Promise.resolve(customDateParserCache);
  }
  if (!customDateParserPromise) {
    customDateParserPromise = import('chrono-node').then(({ casual }) => {
      const parser = casual.clone();
      parser.refiners.push({
        refine: (context: unknown, results: any[]) => {
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
  `\\${CH_PRO}((?:(?!\\s+(?:\\${CH_TAG}|\\${CH_DUE}|t?\\d+[mh]\\b)).)+)`,
  'i',
);
const SHORT_SYNTAX_TAGS_REG_EX = new RegExp(`\\${CH_TAG}[^${ALL_SPECIAL}|\\s]+`, 'gi');

// Literal notation: /\@[^\+|\#|\@]/gi
// Match string starting with the literal @ and followed by 1 or more of the characters
// not in the ALL_SPECIAL
const SHORT_SYNTAX_DUE_REG_EX = new RegExp(`\\${CH_DUE}[^${ALL_SPECIAL}]+`, 'gi');

// Match URLs with protocol (http, https, file) or www prefix
// Matches URLs but excludes trailing punctuation
const SHORT_SYNTAX_URL_REG_EX = new RegExp(
  String.raw`(?:(?:https?|file)://\S+|www\.\S+?)(?=\s|$)`,
  'gi',
);

export const shortSyntax = async (
  task: Task | Partial<Task>,
  config: ShortSyntaxConfig,
  allTags?: Tag[],
  allProjects?: Project[],
  now = new Date(),
  mode: 'combine' | 'replace' = 'combine',
): Promise<
  | {
      taskChanges: Partial<Task>;
      newTagTitles: string[];
      remindAt: number | null;
      projectId: string | undefined;
      attachments: TaskAttachment[];
    }
  | undefined
> => {
  if (!task.title) {
    return;
  }
  if (typeof (task.title as any) !== 'string') {
    throw new Error('No str');
  }

  // TODO clean up this mess
  let taskChanges: Partial<TaskCopy> = {};
  let changesForProject: ProjectChanges = {};
  let changesForTag: TagChanges = {};
  let attachments: TaskAttachment[] = [];

  if (config.isEnableDue) {
    taskChanges = parseTimeSpentChanges(task);
    taskChanges = {
      ...taskChanges,
      ...(await parseScheduledDate(
        { ...task, title: taskChanges.title || task.title },
        now,
      )),
    };
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

  const urlChanges = parseUrlAttachments({
    ...task,
    title: taskChanges.title || task.title,
  });
  if (urlChanges.attachments.length > 0) {
    attachments = urlChanges.attachments;
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
    // remindAt: changesForDue.remindAt
  };
};

const parseProjectChanges = (
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
            // NOTE: only block tags at the beginning if they are numeric (e.g. "#123 task")
            (!isNumericOnly || tagStartIndex > 0)
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

const parseScheduledDate = async (
  task: Partial<TaskCopy>,
  now: Date,
): Promise<DueChanges> => {
  if (!task.title) {
    return {};
  }
  const rr = task.title.match(SHORT_SYNTAX_DUE_REG_EX);

  if (rr && rr[0]) {
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

      return {
        dueWithTime: due,
        dueDay: null,
        // Strip out the short syntax for scheduled date and given date
        title: task.title.replace(textToReplace, '').trim(),
        ...(hasPlannedTime ? {} : { hasPlannedTime: false }),
      };
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

        return {
          dueWithTime: due.getTime(),
          dueDay: null,
          title: task.title.replace(textToReplace, '').trim(),
        };
      }
    }
  }

  return {};
};

const parseTimeSpentChanges = (task: Partial<TaskCopy>): Partial<Task> => {
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

const parseUrlAttachments = (
  task: Partial<TaskCopy>,
): {
  attachments: TaskAttachment[];
  title: string;
} => {
  if (!task.title || task.issueId) {
    return { attachments: [], title: task.title || '' };
  }

  const urlMatches = task.title.match(SHORT_SYNTAX_URL_REG_EX);

  if (!urlMatches || urlMatches.length === 0) {
    return { attachments: [], title: task.title };
  }

  const attachments: TaskAttachment[] = urlMatches.map((url) => {
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

    // Extract basename for title
    const title = _baseNameForUrl(path);

    return {
      id: nanoid(),
      type,
      path,
      title,
      icon,
    };
  });

  // Clean URLs from title - use trimmed URLs without trailing punctuation
  let cleanedTitle = task.title;
  attachments.forEach((attachment) => {
    const attachmentPath = attachment.path;
    if (!attachmentPath) return;
    // For www URLs, the path has '//' prepended, but the original doesn't
    const originalUrl = attachmentPath.startsWith('//')
      ? attachmentPath.substring(2)
      : attachmentPath;
    // Escape special regex characters for safe replacement
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleanedTitle = cleanedTitle.replace(new RegExp(escapedUrl, 'g'), '');
  });
  cleanedTitle = cleanedTitle.trim().replace(/\s+/g, ' ');

  return { attachments, title: cleanedTitle };
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
