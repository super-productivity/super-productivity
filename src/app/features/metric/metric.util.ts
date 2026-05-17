import { Worklog } from '../worklog/worklog.model';
import { Task } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { SimpleMetrics, TaskMetric, ProjectProgress, WorkBlock } from './metric.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';

const SIGNIFICANT_PAUSE_THRESHOLD = 1;

const calculateTimeline = (
  dates: string[],
): {
  actualStart?: string;
  actualEnd?: string;
  totalSpanDays?: number;
  pauses: { start: string; end: string; duration: number }[];
} => {
  const result: any = {
    pauses: [],
  };

  if (dates.length > 0) {
    const sortedDates = [...dates].sort();
    result.actualStart = sortedDates[0];
    result.actualEnd = sortedDates[sortedDates.length - 1];

    const firstDate = new Date(result.actualStart);
    const lastDate = new Date(result.actualEnd);
    result.totalSpanDays =
      Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < sortedDates.length - 1; i++) {
      const current = new Date(sortedDates[i]);
      const next = new Date(sortedDates[i + 1]);
      const diffDays = Math.floor(
        (next.getTime() - current.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays > SIGNIFICANT_PAUSE_THRESHOLD) {
        const oneDay = 1000 * 60 * 60 * 24;
        const pauseStartTs = current.getTime() + oneDay;
        const pauseEndTs = next.getTime() - oneDay;
        result.pauses.push({
          start: getDbDateStr(new Date(pauseStartTs)),
          end: getDbDateStr(new Date(pauseEndTs)),
          duration: diffDays - 1,
        });
      }
    }
  }

  return result;
};

const calculateWorkBlocks = (
  dates: string[],
  pauses: { start: string; end: string; duration: number }[],
): WorkBlock[] => {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const blocks: WorkBlock[] = [];
  let blockStart = sorted[0];
  let blockEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = Math.floor((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diff > 1) {
      blocks.push({
        start: blockStart,
        end: blockEnd,
        days: 0,
        tasksDone: 0,
        isPause: false,
      });
      blockStart = sorted[i];
    }
    blockEnd = sorted[i];
  }
  blocks.push({
    start: blockStart,
    end: blockEnd,
    days: 0,
    tasksDone: 0,
    isPause: false,
  });

  for (const block of blocks) {
    const s = new Date(block.start);
    const e = new Date(block.end);
    block.days = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }

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

// really TaskWithSubTasks?
export const mapSimpleMetrics = ([
  breakNr,
  breakTime,
  worklog,
  totalTimeSpent,
  allTasks,
]: [BreakNr, BreakTime, Worklog, number, Task[]]): SimpleMetrics => {
  const s: any = {
    start: 999999999999999,
    end: getDbDateStr(),
    timeSpent: totalTimeSpent,
    breakTime: Object.keys(breakTime).reduce((acc, d) => acc + breakTime[d], 0),
    breakNr: Object.keys(breakNr).reduce((acc, d) => acc + breakNr[d], 0),
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
  };

  const allWorkDates: string[] = [];
  Object.keys(worklog).forEach((y) => {
    const year = worklog[+y];
    if (year && year.ent) {
      Object.keys(year.ent).forEach((m) => {
        const month = year.ent[+m];
        if (month && month.ent) {
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

  s.daysWorked = allWorkDates.length;

  const timeline = calculateTimeline(allWorkDates);
  s.actualStart = timeline.actualStart;
  s.actualEnd = timeline.actualEnd;
  s.totalSpanDays = timeline.totalSpanDays;
  s.pauses = timeline.pauses;
  s.totalPauseDays = timeline.pauses.reduce((acc, p) => acc + p.duration, 0);
  s.workBlocks = calculateWorkBlocks(allWorkDates, timeline.pauses);

  const taskMetricMap = new Map<string, TaskMetric>();
  const mainTaskIds: string[] = [];

  allTasks.forEach((task: Task) => {
    if (task.created < s.start) {
      s.start = task.created;
    }

    const taskMetric = mapTaskToMetric(task);
    taskMetricMap.set(task.id, taskMetric);

    if (task.parentId) {
      s.nrOfSubTasks++;
    } else {
      s.nrOfMainTasks++;
      s.timeEstimate += task.timeEstimate;
      mainTaskIds.push(task.id);
    }

    if (task.subTaskIds && task.subTaskIds.length) {
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

  // Assemble task tree
  allTasks.forEach((task: Task) => {
    if (task.parentId) {
      const parentMetric = taskMetricMap.get(task.parentId);
      const subMetric = taskMetricMap.get(task.id);
      if (parentMetric && subMetric) {
        parentMetric.subTasks = parentMetric.subTasks || [];
        parentMetric.subTasks.push(subMetric);
      }
    }
  });

  // Aggregate subtask estimates, time, and dates into parent tasks
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
  mainTaskIds.forEach((id) => {
    const mt = taskMetricMap.get(id);
    if (mt) aggregateParentMetrics(mt);
  });

  s.taskMetrics = mainTaskIds
    .map((id) => taskMetricMap.get(id)!)
    .sort((a, b) => {
      // Sort by last activity (actualEnd) descending
      if (a.actualEnd && b.actualEnd) return b.actualEnd.localeCompare(a.actualEnd);
      if (a.actualEnd) return -1;
      if (b.actualEnd) return 1;
      return 0;
    });

  return {
    ...s,
    start: getDbDateStr(s.start),
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
