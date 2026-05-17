import { Worklog } from '../worklog/worklog.model';
import { Task } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { SimpleMetrics, TaskMetric, ProjectProgress, WorkBlock } from './metric.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';

const SIGNIFICANT_PAUSE_THRESHOLD = 1;

const parseDateStr = (str: string): { year: number; month: number; day: number } => {
  const parts = str.split('-');
  return { year: +parts[0], month: +parts[1], day: +parts[2] };
};

const addDays = (str: string, n: number): string => {
  const { year, month, day } = parseDateStr(str);
  const d = new Date(year, month - 1, day + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const extractWorkDatesFromWorklog = (worklog: Worklog): string[] => {
  const allWorkDates: string[] = [];
  Object.keys(worklog).forEach((y) => {
    const year = worklog[+y];
    if (year?.ent) {
      Object.keys(year.ent).forEach((m) => {
        const month = year.ent[+m];
        if (month?.ent) {
          Object.keys(month.ent).forEach((d) => {
            const day = month.ent[+d];
            if (day && day.timeSpent > 0) {
              allWorkDates.push(day.dateStr);
            }
          });
        }
      });
    }
  });
  return allWorkDates;
};

const calculateTimeline = (
  dates: string[],
): {
  actualStart?: string;
  actualEnd?: string;
  totalSpanDays?: number;
  pauses: { start: string; end: string; duration: number }[];
} => {
  if (dates.length === 0) {
    return { pauses: [] };
  }

  const sortedDates = [...dates].sort();
  const actualStart = sortedDates[0];
  const actualEnd = sortedDates[sortedDates.length - 1];

  const firstDate = new Date(actualStart);
  const lastDate = new Date(actualEnd);
  const totalSpanDays =
    Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const pauses: { start: string; end: string; duration: number }[] = [];
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const current = new Date(sortedDates[i]);
    const next = new Date(sortedDates[i + 1]);
    const diffDays = Math.floor(
      (next.getTime() - current.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays > SIGNIFICANT_PAUSE_THRESHOLD) {
      pauses.push({
        start: addDays(sortedDates[i], 1),
        end: addDays(sortedDates[i + 1], -1),
        duration: diffDays - 1,
      });
    }
  }

  return {
    actualStart,
    actualEnd,
    totalSpanDays,
    pauses,
  };
};

const calculateWorkBlocks = (
  dates: string[],
  pauses: { start: string; end: string; duration: number }[],
): WorkBlock[] => {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const rawBlocks: { start: string; end: string }[] = [];
  let blockStart = sorted[0];
  let blockEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = Math.floor((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diff > 1) {
      rawBlocks.push({ start: blockStart, end: blockEnd });
      blockStart = sorted[i];
    }
    blockEnd = sorted[i];
  }
  rawBlocks.push({ start: blockStart, end: blockEnd });

  const blocks: WorkBlock[] = rawBlocks.map((b) => {
    const s = new Date(b.start);
    const e = new Date(b.end);
    return {
      start: b.start,
      end: b.end,
      days: Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      tasksDone: 0,
      isPause: false,
    };
  });

  const result: WorkBlock[] = [];
  let pauseIdx = 0;
  for (let i = 0; i < blocks.length; i++) {
    result.push(blocks[i]);
    if (i < blocks.length - 1 && pauseIdx < pauses.length) {
      const p = pauses[pauseIdx];
      result.push({
        start: p.start,
        end: p.end,
        days: p.duration,
        tasksDone: 0,
        isPause: true,
      });
      pauseIdx++;
    }
  }

  return result;
};

const mapTaskToMetric = (task: Task): TaskMetric => {
  const dates = Object.keys(task.timeSpentOnDay || {}).filter(
    (d) => task.timeSpentOnDay[d] > 0,
  );
  const timeline = calculateTimeline(dates);

  return {
    id: task.id,
    title: task.title,
    timeSpent: task.timeSpent,
    timeEstimate: task.timeEstimate,
    actualStart: timeline.actualStart || getDbDateStr(task.created),
    actualEnd:
      timeline.actualEnd || (task.doneOn ? getDbDateStr(task.doneOn) : undefined),
    pauses: timeline.pauses,
    isDone: task.isDone,
    subTasks: [],
  };
};

const aggregateParentMetrics = (taskMetric: TaskMetric): void => {
  if (!taskMetric.subTasks?.length) return;
  let totalSubEstimate = 0;
  let totalSubTimeSpent = 0;
  let earliestStart = taskMetric.actualStart;
  let latestEnd = taskMetric.actualEnd;

  for (const sub of taskMetric.subTasks) {
    aggregateParentMetrics(sub);
    totalSubEstimate += sub.timeEstimate;
    totalSubTimeSpent += sub.timeSpent;
    if (sub.actualStart && (!earliestStart || sub.actualStart < earliestStart)) {
      earliestStart = sub.actualStart;
    }
    if (sub.actualEnd && (!latestEnd || sub.actualEnd > latestEnd)) {
      latestEnd = sub.actualEnd;
    }
  }

  if (taskMetric.timeEstimate === 0 && totalSubEstimate > 0) {
    taskMetric.timeEstimate = totalSubEstimate;
  }
  if (taskMetric.timeSpent === 0 && totalSubTimeSpent > 0) {
    taskMetric.timeSpent = totalSubTimeSpent;
  }
  if (earliestStart) {
    taskMetric.actualStart = earliestStart;
  }
  if (latestEnd) {
    taskMetric.actualEnd = latestEnd;
  }
};

export const mapSimpleMetrics = ([
  breakNr,
  breakTime,
  worklog,
  totalTimeSpent,
  allTasks,
]: [BreakNr, BreakTime, Worklog, number, Task[]]): SimpleMetrics => {
  const s: Omit<
    SimpleMetrics,
    | 'avgBreakNr'
    | 'avgBreakTime'
    | 'avgTasksPerDay'
    | 'avgTimeSpentOnDay'
    | 'avgTimeSpentOnTask'
    | 'avgTimeSpentOnTaskIncludingSubTasks'
    | 'totalPauseDays'
  > & { startTs: number } = {
    start: '',
    startTs: Infinity,
    end: getDbDateStr(),
    timeSpent: totalTimeSpent,
    breakTime: Object.values(breakTime).reduce((acc, val) => acc + val, 0),
    breakNr: Object.values(breakNr).reduce((acc, val) => acc + val, 0),
    timeEstimate: 0,
    nrOfCompletedTasks: 0,
    nrOfCompletedMainTasks: 0,
    nrOfCompletedSubTasks: 0,
    nrOfAllTasks: allTasks.length,
    nrOfSubTasks: 0,
    nrOfMainTasks: 0,
    nrOfParentTasks: 0,
    daysWorked: 0,
    taskMetrics: [],
    workBlocks: [],
    pauses: [],
  };

  const allWorkDates = extractWorkDatesFromWorklog(worklog);
  s.daysWorked = allWorkDates.length;

  const timeline = calculateTimeline(allWorkDates);
  s.actualStart = timeline.actualStart;
  s.actualEnd = timeline.actualEnd;
  s.totalSpanDays = timeline.totalSpanDays;
  s.pauses = timeline.pauses;
  s.workBlocks = calculateWorkBlocks(allWorkDates, timeline.pauses);

  const taskMetricMap = new Map<string, TaskMetric>();
  const mainTaskIds: string[] = [];

  // First pass: Fill the map with all tasks
  allTasks.forEach((task) => {
    taskMetricMap.set(task.id, mapTaskToMetric(task));
  });

  // Second pass: Link subtasks to parents and calculate counts/estimates
  allTasks.forEach((task: Task) => {
    if (task.created < s.startTs) {
      s.startTs = task.created;
    }

    const taskMetric = taskMetricMap.get(task.id)!;

    if (task.parentId) {
      s.nrOfSubTasks++;
      // Link subtask to parent
      const parentMetric = taskMetricMap.get(task.parentId);
      if (parentMetric) {
        parentMetric.subTasks = parentMetric.subTasks || [];
        parentMetric.subTasks.push(taskMetric);
      }
    } else {
      s.nrOfMainTasks++;
      s.timeEstimate += task.timeEstimate;
      mainTaskIds.push(task.id);
    }

    if (task.subTaskIds?.length) {
      s.nrOfParentTasks++;
    }

    if (task.isDone) {
      s.nrOfCompletedTasks++;
      if (task.parentId) {
        s.nrOfCompletedSubTasks++;
      } else {
        s.nrOfCompletedMainTasks++;
      }
    }
  });

  mainTaskIds.forEach((id) => {
    const mt = taskMetricMap.get(id);
    if (mt) aggregateParentMetrics(mt);
  });

  const totalPauseDays = s.pauses.reduce((acc, p) => acc + p.duration, 0);

  s.taskMetrics = mainTaskIds
    .map((id) => taskMetricMap.get(id)!)
    .sort((a, b) => {
      if (a.actualEnd && b.actualEnd) return b.actualEnd.localeCompare(a.actualEnd);
      if (a.actualEnd) return -1;
      if (b.actualEnd) return 1;
      return 0;
    });

  return {
    ...s,
    start: getDbDateStr(s.startTs === Infinity ? Date.now() : s.startTs),
    totalPauseDays,
    avgBreakNr: s.daysWorked > 0 ? s.breakNr / s.daysWorked : 0,
    avgBreakTime: s.daysWorked > 0 ? s.breakTime / s.daysWorked : 0,
    avgTasksPerDay: s.daysWorked > 0 ? s.nrOfMainTasks / s.daysWorked : 0,
    avgTimeSpentOnDay: s.daysWorked > 0 ? s.timeSpent / s.daysWorked : 0,
    avgTimeSpentOnTask: s.nrOfMainTasks > 0 ? s.timeSpent / s.nrOfMainTasks : 0,
    avgTimeSpentOnTaskIncludingSubTasks:
      s.nrOfAllTasks - s.nrOfParentTasks > 0
        ? s.timeSpent / (s.nrOfAllTasks - s.nrOfParentTasks)
        : 0,
  };
};

export const calculateProjectProgress = (
  sm: SimpleMetrics,
  targetStartDate?: string | null,
  targetDate?: string | null,
  targetDuration?: number | null,
): ProjectProgress | null => {
  const totalTasks = sm.nrOfAllTasks;
  if (totalTasks === 0) return null;

  const startDate = targetStartDate || sm.actualStart || sm.start;
  const today = getDbDateStr();

  let deadline: string;
  if (targetDate) {
    deadline = targetDate;
  } else if (targetDuration) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + targetDuration);
    deadline = getDbDateStr(d);
  } else {
    return null;
  }

  const startMs = new Date(startDate).getTime();
  const deadlineMs = new Date(deadline).getTime();
  const todayMs = new Date(today).getTime();

  if (deadlineMs <= startMs) return null;

  const totalDays = Math.max(
    1,
    Math.floor((deadlineMs - startMs) / (1000 * 60 * 60 * 24)),
  );
  const daysElapsed = Math.max(
    0,
    Math.min(totalDays, Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24))),
  );
  const daysRemaining = totalDays - daysElapsed;

  const doneTasks = sm.nrOfCompletedTasks || 0;
  const remainingTasks = totalTasks - doneTasks;

  const totalMainTasks = sm.nrOfMainTasks;
  const doneMainTasks = sm.nrOfCompletedMainTasks || 0;

  const mainProgressPercent =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const allProgressPercent =
    sm.nrOfAllTasks > 0 ? Math.round((sm.nrOfCompletedTasks / sm.nrOfAllTasks) * 100) : 0;

  const historicalPace =
    daysElapsed > 0
      ? doneTasks / daysElapsed
      : sm.daysWorked > 0
        ? doneTasks / sm.daysWorked
        : 0;
  const requiredPace = daysRemaining > 0 ? remainingTasks / daysRemaining : 0;
  const isAhead =
    daysElapsed > 0 && (historicalPace >= requiredPace || daysRemaining <= 0);

  const daysToDeadline = remainingTasks / historicalPace;
  const offsetMs = daysToDeadline * 86400000;
  const predictedEndDate =
    historicalPace > 0 ? getDbDateStr(new Date(todayMs + offsetMs)) : today;

  const timeProgressPercent =
    sm.timeEstimate > 0
      ? Math.round(Math.min(100, (sm.timeSpent / sm.timeEstimate) * 100))
      : 0;

  return {
    startDate,
    deadline,
    totalMainTasks,
    doneMainTasks,
    totalTasks,
    doneTasks,
    remainingTasks,
    totalSubTasks: sm.nrOfSubTasks,
    doneSubTasks: sm.nrOfCompletedSubTasks || 0,
    mainProgressPercent,
    allProgressPercent,
    daysElapsed,
    daysRemaining,
    totalDays,
    historicalPace,
    requiredPace,
    isAhead,
    predictedEndDate,
    timeSpent: sm.timeSpent,
    timeEstimate: sm.timeEstimate,
    timeProgressPercent,
  };
};
