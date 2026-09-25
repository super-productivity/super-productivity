import { msToClockString } from '../../../ui/duration/ms-to-clock-string.pipe';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import { formatTimeHHmm } from '../../../util/format-time-hhmm';
import { roundDuration } from '../../../util/round-duration';
import { roundTime } from '../../../util/round-time';
import { unique } from '../../../util/unique';
import { ProjectCopy } from '../../project/project.model';
import { TagCopy } from '../../tag/tag.model';
import { WorklogTask } from '../../tasks/task.model';
import { resolveDisplayTagIds } from '../../tasks/util/resolve-display-tag-ids.util';
import {
  WorklogColTypes,
  WorklogExportSettingsCopy,
  WorklogGrouping,
} from '../worklog.model';
import { Log } from '../../../core/log';
import {
  ItemsByKey,
  RowItem,
  TaskFields,
  TimeFields,
  WorklogExportData,
} from './worklog-export.model';

const LINE_SEPARATOR = '\n';
const EMPTY_VAL = ' - ';

interface ExportLookups {
  tasks: Map<string, WorklogTask>;
  projects: Map<string, ProjectCopy>;
  tags: Map<string, TagCopy>;
}

const indexById = <T extends { id: string }>(items: T[]): Map<string, T> => {
  const index = new Map<string, T>();
  for (const item of items) {
    // Match Array.find: the first occurrence wins.
    if (!index.has(item.id)) {
      index.set(item.id, item);
    }
  }
  return index;
};
/**
 * Leading `= + - @ TAB CR LF` make Excel/LibreOffice evaluate the cell as a
 * formula, so a task title like `=cmd|' /C calc'!A0` would execute on open
 * (OWASP CSV injection).
 */
const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r\n]/;
const CSV_NEEDS_QUOTING_RE = /[;"\r\n]/;

const escapeCsvField = (value: string | number | undefined): string => {
  const raw = value === undefined ? '' : String(value);
  // `-` alone is the zero-duration placeholder of msToString/msToClockString and
  // not a formula, so it must stay bare — TIME_CLOCK is a default column, and
  // prefixing would corrupt every zero row of an ordinary export.
  // The apostrophe makes spreadsheets treat the cell as literal text (they hide
  // it; plain-text consumers will see it).
  const field = raw !== '-' && CSV_FORMULA_PREFIX_RE.test(raw) ? `'${raw}` : raw;
  return CSV_NEEDS_QUOTING_RE.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
};

/**
 * Depending on groupBy it gets a map of RowItems by groupKeys (date, task.id, date_task.id).
 * Then it sorts and reiterates on groupKey and converts the map into a simple array of RowItems.
 */
export const createRows = (
  data: WorklogExportData,
  groupBy: WorklogGrouping,
): RowItem[] => {
  let groups: ItemsByKey<RowItem> = {};
  const lookups: ExportLookups = {
    tasks: indexById(data.tasks),
    projects: indexById(data.projects),
    tags: indexById(data.tags),
  };

  switch (groupBy) {
    case WorklogGrouping.DATE:
      groups = handleDateGroup(data, lookups);
      break;
    case WorklogGrouping.WORKLOG: // don't group at all
      groups = handleWorklogGroup(data, lookups);
      break;
    default:
      // group by TASK/PARENT
      groups = handleTaskGroup(data, groupBy, lookups);
  }

  const rows: RowItem[] = [];
  Object.keys(groups)
    .sort()
    .forEach((key) => {
      rows.push(groups[key]);
    });

  return groupBy === WorklogGrouping.WORKLOG ? clearRepeatedWorklogDayTimes(rows) : rows;
};

/**
 * For each task it sets taskFields and iterates over timeSpentOnDay.
 * For each timeSpentOnDay it sets timeFields and either creates a new taskGroup or pushes to a previous one.
 */
const handleDateGroup = (
  data: WorklogExportData,
  lookups: ExportLookups,
): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    if (!task.timeSpentOnDay) {
      continue;
    }
    const taskFields = getTaskFields(task, lookups);
    const numDays = Object.keys(task.timeSpentOnDay).length;
    let timeEstimate = 0;
    let timeSpent = 0;
    Object.keys(task.timeSpentOnDay).forEach((day) => {
      if (!task.subTaskIds || task.subTaskIds.length === 0) {
        timeSpent = task.timeSpentOnDay[day];
        timeEstimate = task.timeEstimate / numDays;
      }

      const timeFields: TimeFields = {
        dates: [day],
        workStart: data.workTimes.start[day],
        workEnd: data.workTimes.end[day],
        timeSpent,
        timeEstimate,
      };

      const group = taskGroups[day];
      if (!group) {
        // cloneTaskFields is the only way taskFields reaches a row, so no two
        // days of the same task can share an array that the merge below mutates.
        taskGroups[day] = { ...timeFields, ...cloneTaskFields(taskFields) };
      } else {
        group.titles.push(...taskFields.titles);
        group.titlesWithSub.push(...taskFields.titlesWithSub);
        group.tasks.push(...taskFields.tasks);
        group.notes.push(...taskFields.notes);
        group.projects.push(...taskFields.projects);
        group.tags.push(...taskFields.tags);
        if (group.workStart !== undefined) {
          // TODO check if this works as intended
          group.workStart = Math.min(
            group.workStart as number,
            timeFields.workStart as number,
          );
        }
        if (group.workEnd !== undefined) {
          // TODO check if this works as intended
          group.workEnd = Math.min(group.workEnd as number, timeFields.workEnd as number);
        }
        group.timeEstimate += timeFields.timeEstimate;
        group.timeSpent += timeFields.timeSpent;
      }
    });
  }
  for (const row of Object.values(taskGroups)) {
    // Historically only merged rows are deduplicated. Keep a single task's
    // display tags intact, including different tags that share a title.
    if (row.tasks.length > 1) {
      row.titles = unique(row.titles);
      row.projects = unique(row.projects);
      row.tags = unique(row.tags);
    }
  }
  return taskGroups;
};

/**
 * If we're grouping by parent task ignore subtasks
 * If we're grouping by task ignore parent tasks
 */
const skipTask = (task: WorklogTask, groupBy: WorklogGrouping): boolean => {
  return (
    (groupBy === WorklogGrouping.PARENT && !!task.parentId) ||
    (groupBy === WorklogGrouping.TASK && task.subTaskIds.length > 0)
  );
};

/**
 * For each task creates a new rowItem without needing to push to previous taskGroups, unlike handleDateGroup.
 * We're still creating a map since we will use the key for sorting in the next step.
 */
const handleTaskGroup = (
  data: WorklogExportData,
  groupBy: WorklogGrouping,
  lookups: ExportLookups,
): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    if (skipTask(task, groupBy)) {
      continue;
    }
    if (!task.timeSpentOnDay) {
      continue;
    }
    const taskFields = getTaskFields(task, lookups);
    const dates = sortDateStrings(Object.keys(task.timeSpentOnDay));
    taskGroups[task.id] = {
      dates,
      timeEstimate: task.timeEstimate,
      timeSpent: Object.values(task.timeSpentOnDay).reduce((acc, curr) => acc + curr, 0),
      workStart: 0,
      workEnd: 0,
      ...taskFields,
    };
  }
  return taskGroups;
};

/**
 * For each task creates a new rowItem without needing to push to previous taskGroups, unlike handleDateGroup.
 * We're still creating a map since we will use the key for sorting in the next step.
 */
const handleWorklogGroup = (
  data: WorklogExportData,
  lookups: ExportLookups,
): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    if (!task.timeSpentOnDay) {
      continue;
    }
    Object.keys(task.timeSpentOnDay).forEach((day) => {
      const groupKey = day + '_' + task.id;
      const taskFields = getTaskFields(task, lookups);
      taskGroups[groupKey] = {
        dates: [day],
        timeEstimate: task.subTaskIds.length > 0 ? 0 : task.timeEstimate,
        timeSpent: task.subTaskIds.length > 0 ? 0 : task.timeSpentOnDay[day],
        workStart: data.workTimes.start[day],
        workEnd: data.workTimes.end[day],
        ...taskFields,
      };
    });
  }
  return taskGroups;
};

const clearRepeatedWorklogDayTimes = (rows: RowItem[]): RowItem[] => {
  const seenDays = new Set<string>();
  return rows.map((row) => {
    const day = row.dates[0];
    if (seenDays.has(day)) {
      return {
        ...row,
        workStart: 0,
        workEnd: 0,
      };
    }
    seenDays.add(day);
    return row;
  });
};

/**
 * Unfolds task into taskFields while mapping id's to titles, and minor formatting
 */
const getTaskFields = (task: WorklogTask, lookups: ExportLookups): TaskFields => {
  const titlesWithSub = [task.title];
  const parentTask = task.parentId
    ? // NOTE: we use 'ERR' to still throw an error for invalid data
      (lookups.tasks.get(task.parentId) as WorklogTask) || 'ERR'
    : undefined;

  const titles = parentTask ? [parentTask.title] : [task.title];

  const notes = task.notes ? [task.notes.replace(/\n/g, ' - ')] : [];
  const projects = task.projectId
    ? [(lookups.projects.get(task.projectId) as ProjectCopy).title]
    : [];

  const tags = resolveDisplayTagIds(
    task,
    typeof parentTask === 'object' ? parentTask : undefined,
  ).map((tagId) => (lookups.tags.get(tagId) as TagCopy).title);

  const tasks = [task];
  return { tasks, titlesWithSub, titles, notes, projects, tags };
};

/**
 * getTaskFields is computed once per task but its arrays end up in every day that
 * task contributed to, and handleDateGroup accumulates into them by mutation, so
 * each day needs its own copies. Returning TaskFields makes a newly added required
 * field a compile error here; an optional one would still need adding by hand.
 * handleTaskGroup/handleWorklogGroup spread taskFields directly on purpose —
 * neither ever merges, so nothing mutates what they store.
 */
const cloneTaskFields = (fields: TaskFields): TaskFields => ({
  tasks: [...fields.tasks],
  titles: [...fields.titles],
  titlesWithSub: [...fields.titlesWithSub],
  notes: [...fields.notes],
  projects: [...fields.projects],
  tags: [...fields.tags],
});

const sortDateStrings = (dates: string[]): string[] => {
  return dates.sort((a: string, b: string) => {
    const dateA: number = new Date(a).getTime();
    const dateB: number = new Date(b).getTime();
    if (dateA === dateB) {
      return 0;
    } else if (dateA < dateB) {
      return -1;
    }
    return 1;
  });
};

/**
 * Reiterates cell by cell and applies formatting based on requested Column Type
 */
export const formatRows = (
  rows: RowItem[],
  options: WorklogExportSettingsCopy,
): (string | number | undefined)[][] => {
  return rows.map((row: RowItem) => {
    return options.cols.map((col) => {
      // TODO check if this is possible
      if (!col) {
        return;
      }
      if (!row.titles || !row.titlesWithSub) {
        throw new Error('Worklog: No titles');
      }

      const timeSpent = options.roundWorkTimeTo
        ? roundDuration(row.timeSpent, options.roundWorkTimeTo, true).asMilliseconds()
        : row.timeSpent;

      // If we're exporting raw worklogs, spread estimated time over worklogs belonging to a task based on
      // its share in time spent on the task
      let timeEstimate = row.timeEstimate;
      if (
        options.groupBy === WorklogGrouping.WORKLOG &&
        (col === 'ESTIMATE_MS' || col === 'ESTIMATE_STR' || col === 'ESTIMATE_CLOCK')
      ) {
        const timeSpentTotal = Object.values(row.tasks[0].timeSpentOnDay).reduce(
          (acc, curr) => acc + curr,
          0,
        );
        const timeSpentPart = row.timeSpent / timeSpentTotal;
        Log.log(`${row.timeSpent} / ${timeSpentTotal} = ${timeSpentPart}`);
        timeEstimate = timeEstimate * timeSpentPart;
      }

      switch (col) {
        case 'DATE':
          if (row.dates.length > 1) {
            return row.dates[0] + ' - ' + row.dates[row.dates.length - 1];
          }
          return row.dates[0];
        case 'START':
          const workStart = !row.workStart ? 0 : row.workStart;
          return workStart
            ? formatTimeHHmm(
                options.roundStartTimeTo
                  ? roundTime(workStart, options.roundStartTimeTo)
                  : workStart,
              )
            : EMPTY_VAL;
        case 'END':
          return row.workEnd
            ? formatTimeHHmm(
                options.roundEndTimeTo && row.workEnd
                  ? roundTime(row.workEnd, options.roundEndTimeTo)
                  : row.workEnd,
              )
            : EMPTY_VAL;
        case 'TITLES':
          return row.titles.join(options.separateTasksBy || '<br>');
        case 'TITLES_INCLUDING_SUB':
          return row.titlesWithSub.join(options.separateTasksBy || '<br>');
        case 'NOTES':
          return row.notes.length !== 0
            ? row.notes.join(options.separateTasksBy)
            : EMPTY_VAL;
        case 'PROJECTS':
          return row.projects.length !== 0
            ? row.projects.join(options.separateTasksBy)
            : EMPTY_VAL;
        case 'TAGS':
          return row.tags.length !== 0
            ? row.tags.join(options.separateTasksBy)
            : EMPTY_VAL;
        case 'TIME_MS':
          return timeSpent;
        case 'TIME_STR':
          return msToString(timeSpent);
        case 'TIME_CLOCK':
          return msToClockString(timeSpent);
        case 'ESTIMATE_MS':
          return timeEstimate;
        case 'ESTIMATE_STR':
          return msToString(timeEstimate);
        case 'ESTIMATE_CLOCK':
          return msToClockString(timeEstimate);
        default:
          return EMPTY_VAL;
      }
    });
  });
};

/**
 * Deliberately untranslated: the headers are consumed by spreadsheets and
 * scripts, so they must not vary with the UI language.
 */
export const getHeadlineCol = (col: WorklogColTypes): string => {
  switch (col) {
    case 'DATE':
      return 'Date';
    case 'START':
      return 'Start';
    case 'END':
      return 'End';
    case 'TITLES':
      // must differ from TITLES_INCLUDING_SUB: both columns can be exported
      // together to attribute a sub-task row to its parent task
      return 'Parent Titles';
    case 'TITLES_INCLUDING_SUB':
      return 'Titles';
    case 'NOTES':
      return 'Descriptions';
    case 'PROJECTS':
      return 'Projects';
    case 'TAGS':
      return 'Tags';
    case 'TIME_MS':
    case 'TIME_STR':
    case 'TIME_CLOCK':
      return 'Worked';
    case 'ESTIMATE_MS':
    case 'ESTIMATE_STR':
    case 'ESTIMATE_CLOCK':
      return 'Estimate';
    default:
      return 'INVALID COL';
  }
};

/**
 * Prepares the csv for export
 */
export const formatText = (
  headlineCols: string[],
  rows: (string | number | undefined)[][],
): string => {
  let txt = '';
  txt += headlineCols.map(escapeCsvField).join(';') + LINE_SEPARATOR;
  txt += rows.map((cols) => cols.map(escapeCsvField).join(';')).join(LINE_SEPARATOR);
  return txt;
};
