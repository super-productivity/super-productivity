import { Routes } from '@angular/router';
import { HistoryComponent } from '../features/history/history.component';
import { DailySummaryComponent } from '../pages/daily-summary/daily-summary.component';
import { MetricPageComponent } from '../pages/metric-page/metric-page.component';
import { ProjectTaskPageComponent } from '../pages/project-task-page/project-task-page.component';

const SHARED_CONTEXT_ROUTES: Routes = [
  {
    path: 'history',
    component: HistoryComponent,
    data: { page: 'history' },
  },
  // legacy routes: Quick History was merged into the single History view
  {
    path: 'worklog',
    redirectTo: 'history',
    pathMatch: 'full',
  },
  {
    path: 'quick-history',
    redirectTo: 'history',
    pathMatch: 'full',
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
