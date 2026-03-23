import { Routes } from '@angular/router';
import { WorklogComponent } from '../features/worklog/worklog.component';
import { QuickHistoryComponent } from '../features/quick-history/quick-history.component';
import { DailySummaryComponent } from '../pages/daily-summary/daily-summary.component';
import { MetricPageComponent } from '../pages/metric-page/metric-page.component';
import { ProjectTaskPageComponent } from '../pages/project-task-page/project-task-page.component';

const SHARED_CONTEXT_ROUTES: Routes = [
  {
    path: 'worklog',
    component: WorklogComponent,
    data: { page: 'worklog' },
  },
  {
    path: 'quick-history',
    component: QuickHistoryComponent,
    data: { page: 'quick-history' },
  },
  {
    path: 'daily-summary',
    component: DailySummaryComponent,
    data: { page: 'daily-summary' },
  },
  {
    path: 'daily-summary/:dayStr',
    component: DailySummaryComponent,
    data: { page: 'daily-summary' },
  },
  {
    path: 'metrics',
    component: MetricPageComponent,
    data: { page: 'metrics' },
  },
];

export const TAG_CHILD_ROUTES: Routes = [...SHARED_CONTEXT_ROUTES];

export const PROJECT_CHILD_ROUTES: Routes = [
  {
    path: 'tasks',
    component: ProjectTaskPageComponent,
    data: { page: 'project-tasks' },
  },
  ...SHARED_CONTEXT_ROUTES,
];
