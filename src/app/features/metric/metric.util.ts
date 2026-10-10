import { Worklog } from '../worklog/worklog.model';
import { Task } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { SimpleMetrics } from './metric.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';
import { exists } from '../../util/exists';

// really TaskWithSubTasks?
export const mapSimpleMetrics = ([
  breakNr,
  breakTime,
  worklog,
  totalTimeSpent,
  allTasks,
]: [BreakNr, BreakTime, Worklog, number, Task[]]): SimpleMetrics => {
  const s = {
    start: 999999999999999,
    end: getDbDateStr(),
    timeSpent: totalTimeSpent,
    breakTime: Object.keys(breakTime).reduce((acc, d) => acc + breakTime[d], 0),
    breakNr: Object.keys(breakNr).reduce((acc, d) => acc + breakNr[d], 0),
    timeEstimate: 0,
    nrOfCompletedTasks: 0,
    nrOfAllTasks: allTasks.length,
    nrOfSubTasks: 0,
    nrOfMainTasks: 0,
    nrOfParentTasks: 0,
    daysWorked: Object.keys(worklog).reduce((acc, y: any) => {
      return acc + exists<any>(worklog[y]).daysWorked;
    }, 0),
  };

  allTasks.forEach((task: Task) => {
    if (task.created < s.start) {
      s.start = task.created;
    }

    if (task.parentId) {
      s.nrOfSubTasks++;
    } else {
      s.nrOfMainTasks++;
      s.timeEstimate += task.timeEstimate;
    }

    if (task.subTaskIds && task.subTaskIds.length) {
      s.nrOfParentTasks++;
    } else {
      // s.timeSpent = s.timeSpent + Object.keys(task.timeSpentOnDay).reduce((acc, v) => acc + task.timeSpentOnDay [v], 0);
    }

    // A task dismissed as won't do is finished, but it was never completed.
    if (task.isDone && task.doneReason !== 'wontDo') {
      s.nrOfCompletedTasks++;
    }
  });

  return {
    ...s,
    start: getDbDateStr(s.start),
    avgBreakNr: s.breakNr / s.daysWorked,
    avgBreakTime: s.breakTime / s.daysWorked,
    avgTasksPerDay: s.nrOfMainTasks / s.daysWorked,
    avgTimeSpentOnDay: s.timeSpent / s.daysWorked,
    avgTimeSpentOnTask: s.timeSpent / s.nrOfMainTasks,
    avgTimeSpentOnTaskIncludingSubTasks:
      s.timeSpent / (s.nrOfAllTasks - s.nrOfParentTasks),
  };
};
