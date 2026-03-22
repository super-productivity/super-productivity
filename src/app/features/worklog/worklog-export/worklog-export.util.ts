import { msToClockString } from '../../../ui/duration/ms-to-clock-string.pipe';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import { formatTimeHHmm } from '../../../util/format-time-hhmm';
import { roundDuration } from '../../../util/round-duration';
import { roundTime } from '../../../util/round-time';
import { unique } from '../../../util/unique';
import { ProjectCopy } from '../../project/project.model';
import { TagCopy } from '../../tag/tag.model';
import { WorklogTask } from '../../tasks/task.model';
import { WorklogExportSettingsCopy, WorklogGrouping } from '../worklog.model';
import { Log } from '../../../core/log';
import {
  ItemsByKey,
  RowItem,
  TaskFields,
  WorklogExportData,
} from './worklog-export.model';

const LINE_SEPARATOR = '\n';
const EMPTY_VAL = ' - ';

/**
 * Depending on groupBy it gets a map of RowItems by groupKeys (date, task.id, date_task.id).
 * Then it sorts and reiterates on groupKey and converts the map into a simple array of RowItems.
 */
export const createRows = (
  data: WorklogExportData,
  groupBy: WorklogGrouping,
): RowItem[] => {
  let groups: ItemsByKey<RowItem> = {};

  switch (groupBy) {
    case WorklogGrouping.DATE:
      groups = handleDateGroup(data);
      break;
    case WorklogGrouping.WORKLOG: // don't group at all
      groups = handleWorklogGroup(data);
      break;
    default:
      // group by TASK/PARENT
      groups = handleTaskGroup(data, groupBy);
  }

  const rows: RowItem[] = [];
  Object.keys(groups)
    .sort()
    .forEach((key) => {
      rows.push(groups[key]);
    });

  return rows;
};

/**
 * For each task it sets taskFields and iterates over timeSpentOnDay.
 * For each timeSpentOnDay it sets timeFields and either creates a new taskGroup or pushes to a previous one.
 */
const handleDateGroup = (data: WorklogExportData): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    if (!task.timeSpentOnDay) {
      continue;
    }

    const taskFields = getTaskFields(task, data);
    const numDays = Object.keys(task.timeSpentOnDay).length;
    let timeEstimate = 0;
    let timeSpent = 0;
    Object.keys(task.timeSpentOnDay).forEach((day) => {
      if (!task.subTaskIds || task.subTaskIds.length === 0) {
        timeSpent = task.timeSpentOnDay[day];
        timeEstimate = task.timeEstimate / numDays;
      }

      const rowItem: RowItem = {
        dates: [day],
        workStart: data.workTimes.start[day],
        workEnd: data.workTimes.end[day],
        timeSpent,
        timeEstimate,
        ...taskFields,
      };

      if (!taskGroups[day]) {
        taskGroups[day] = rowItem;
      } else {
        taskGroups[day].titles = unique([...taskGroups[day].titles, ...rowItem.titles]);
        taskGroups[day].titlesWithSub = [
          ...taskGroups[day].titlesWithSub,
          ...rowItem.titlesWithSub,
        ];
        taskGroups[day].tasks = [...taskGroups[day].tasks, ...rowItem.tasks];
        taskGroups[day].notes = [...taskGroups[day].notes, ...rowItem.notes];
        taskGroups[day].projects = unique([
          ...taskGroups[day].projects,
          ...rowItem.projects,
        ]);
        taskGroups[day].tags = unique([...taskGroups[day].tags, ...rowItem.tags]);
        if (taskGroups[day].workStart !== undefined) {
          // TODO check if this works as intended
          taskGroups[day].workStart = Math.min(
            taskGroups[day].workStart as number,
            rowItem.workStart as number,
          );
        }
        if (taskGroups[day].workEnd !== undefined) {
          // TODO check if this works as intended
          taskGroups[day].workEnd = Math.min(
            taskGroups[day].workEnd as number,
            rowItem.workEnd as number,
          );
        }
        taskGroups[day].timeEstimate += rowItem.timeEstimate;
        taskGroups[day].timeSpent += rowItem.timeSpent;
      }
    });
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
): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    if (skipTask(task, groupBy)) {
      continue;
    }
    const taskFields = getTaskFields(task, data);
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
const handleWorklogGroup = (data: WorklogExportData): ItemsByKey<RowItem> => {
  const taskGroups: ItemsByKey<RowItem> = {};
  for (const task of data.tasks) {
    Object.keys(task.timeSpentOnDay).forEach((day) => {
      const groupKey = day + '_' + task.id;
      const taskFields = getTaskFields(task, data);
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

/**
 * Unfolds task into taskFields while mapping id's to titles, and minor formatting
 */
const getTaskFields = (task: WorklogTask, data: WorklogExportData): TaskFields => {
  const titlesWithSub = [task.title];
  const parentTask = task.parentId
    ? // NOTE: we use 'ERR' to still throw an error for invalid data
      (data.tasks.find((t) => t.id === task.parentId) as WorklogTask) || 'ERR'
    : undefined;

  const titles = parentTask ? [parentTask.title] : [task.title];

  const notes = task.notes ? [task.notes.replace(/\n/g, ' - ')] : [];
  const projects = task.projectId
    ? [
        (data.projects.find((project) => project.id === task.projectId) as ProjectCopy)
          .title,
      ]
    : [];

  // by design subtasks don't have tags, so we must set its parent's tags
  let tags = parentTask ? parentTask.tagIds : task.tagIds;
  tags = tags.map(
    (tagId) => (data.tags.find((tag) => tag.id === tagId) as TagCopy).title,
  );

  const tasks = [task];
  return { tasks, titlesWithSub, titles, notes, projects, tags };
};

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
 * Prepares the csv for export
 */
export const formatText = (
  headlineCols: string[],
  rows: (string | number | undefined)[][],
): string => {
  let txt = '';
  txt += headlineCols.join(';') + LINE_SEPARATOR;
  txt += rows.map((cols) => cols.join(';')).join(LINE_SEPARATOR);
  return txt;
};
