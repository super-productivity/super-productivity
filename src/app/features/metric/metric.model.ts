import { EntityState } from '@ngrx/entity';
// import { Label, SingleDataSet } from 'ng2-charts';
import { ChartData } from 'chart.js';

export interface ReflectionEntry {
  text: string;
  created: number;
}

export interface MetricCopy {
  // string date of day
  id: string;

  focusSessions?: number[];

  // Evaluation fields
  notes?: string | null;
  remindTomorrow?: boolean;
  reflections?: ReflectionEntry[];

  // v2.4 Productivity scoring fields (impact-driven)
  impactOfWork?: number | null; // 1-4 scale

  // v2.3 Sustainability scoring fields
  energyCheckin?: number | null; // 1-3 scale (simple: 1=exhausted, 2=ok, 3=good)

  // TODO remove
  totalWorkMinutes?: number | null; // Total work time in minutes
  // Optional task completion tracking (for future use in productivity)
  completedTasks?: number | null;
  plannedTasks?: number | null;
}

export type Metric = Readonly<MetricCopy>;

export type MetricState = EntityState<Metric>;

export type PieChartData = ChartData<'pie', number[], string>;
export type LineChartData = ChartData<'line', (number | undefined)[], string>;

export interface TaskMetric {
  id: string;
  title: string;
  timeSpent: number;
  timeEstimate: number;
  actualStart?: string;
  actualEnd?: string;
  pauses?: { start: string; end: string; duration: number }[];
  isDone: boolean;
  subTasks?: TaskMetric[];
}

export interface WorkBlock {
  start: string;
  end: string;
  days: number;
  tasksDone: number;
  isPause: boolean;
}

export interface ProjectProgress {
  startDate: string;
  deadline: string;
  totalMainTasks: number;
  doneMainTasks: number;
  totalSubTasks: number;
  doneSubTasks: number;
  totalTasks: number;
  doneTasks: number;
  remainingTasks: number;
  mainProgressPercent: number;
  allProgressPercent: number;
  daysElapsed: number;
  daysRemaining: number;
  totalDays: number;
  historicalPace: number;
  requiredPace: number;
  isAhead: boolean;
  predictedEndDate: string;
  timeSpent: number;
  timeEstimate: number;
  timeProgressPercent: number;
}

export interface SimpleMetrics {
  start: string;
  end: string;
  actualStart?: string;
  actualEnd?: string;
  totalSpanDays?: number;
  totalPauseDays?: number;
  pauses?: { start: string; end: string; duration: number }[];
  workBlocks?: WorkBlock[];
  taskMetrics?: TaskMetric[];
  timeSpent: number;
  timeEstimate: number;
  breakTime: number;
  breakNr: number;
  nrOfCompletedTasks: number;
  nrOfCompletedMainTasks: number;
  nrOfCompletedSubTasks: number;
  nrOfAllTasks: number;
  nrOfSubTasks: number;
  nrOfMainTasks: number;
  nrOfParentTasks: number;
  daysWorked: number;
  avgTasksPerDay: number;
  avgTimeSpentOnDay: number;
  avgTimeSpentOnTask: number;
  avgTimeSpentOnTaskIncludingSubTasks: number;
  avgBreakNr: number;
  avgBreakTime: number;
}
