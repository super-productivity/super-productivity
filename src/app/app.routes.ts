import { Routes } from '@angular/router';

import {
  ActiveWorkContextGuard,
  DefaultStartPageGuard,
  FocusOverlayOpenGuard,
  ValidProjectIdGuard,
  ValidTagIdGuard,
} from './app.guard';

import { TagTaskPageComponent } from './pages/tag-task-page/tag-task-page.component';

export const APP_ROUTES: Routes = [
  {
    path: 'config',
    loadComponent: () =>
      import('./pages/config-page/config-page.component').then(
        (m) => m.ConfigPageComponent,
      ),
    data: { page: 'config' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./pages/search-page/search-page.component').then(
        (m) => m.SearchPageComponent,
      ),
    data: { page: 'search' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'scheduled-list',
    loadComponent: () =>
      import('./pages/scheduled-list-page/scheduled-list-page.component').then(
        (m) => m.ScheduledListPageComponent,
      ),
    data: { page: 'scheduled-list' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'planner',
    loadComponent: () =>
      import('./features/planner/planner.component').then((m) => m.PlannerComponent),
    data: { page: 'planner' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'schedule',
    loadComponent: () =>
      import('./features/schedule/schedule/schedule.component').then(
        (m) => m.ScheduleComponent,
      ),
    data: { page: 'schedule' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'boards',
    loadComponent: () =>
      import('./features/boards/boards.component').then((m) => m.BoardsComponent),
    data: { page: 'boards' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'habits',
    loadComponent: () =>
      import('./pages/habit-page/habit-page.component').then((m) => m.HabitPageComponent),
    data: { page: 'habits' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/tasks',
    // eagerly loaded
    component: TagTaskPageComponent,
    // loadComponent: () =>
    //   import('./pages/tag-task-page/tag-task-page.component').then(
    //     (m) => m.TagTaskPageComponent,
    //   ),
    data: { page: 'tag-tasks' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/settings',
    loadComponent: () =>
      import('./pages/tag-settings-page/tag-settings-page.component').then(
        (m) => m.TagSettingsPageComponent,
      ),
    data: { page: 'tag-settings' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/worklog',
    loadComponent: () =>
      import('./features/worklog/worklog.component').then((m) => m.WorklogComponent),
    data: { page: 'worklog' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/quick-history',
    loadComponent: () =>
      import('./features/quick-history/quick-history.component').then(
        (m) => m.QuickHistoryComponent,
      ),
    data: { page: 'quick-history' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  // {path: 'tag/:id/metrics', component: MetricPageComponent, data: {page: 'metrics'}, canActivate: [ValidContextIdGuard, FocusOverlayOpenGuard]},
  {
    path: 'tag/:id/daily-summary',
    loadComponent: () =>
      import('./pages/daily-summary/daily-summary.component').then(
        (m) => m.DailySummaryComponent,
      ),
    data: { page: 'daily-summary' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/daily-summary/:dayStr',
    loadComponent: () =>
      import('./pages/daily-summary/daily-summary.component').then(
        (m) => m.DailySummaryComponent,
      ),
    data: { page: 'daily-summary' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'tag/:id/metrics',
    loadComponent: () =>
      import('./pages/metric-page/metric-page.component').then(
        (m) => m.MetricPageComponent,
      ),
    data: { page: 'metrics' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },

  {
    path: 'project/:id/tasks',
    loadComponent: () =>
      import('./pages/project-task-page/project-task-page.component').then(
        (m) => m.ProjectTaskPageComponent,
      ),
    data: { page: 'project-tasks' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/settings',
    loadComponent: () =>
      import('./pages/project-settings-page/project-settings-page.component').then(
        (m) => m.ProjectSettingsPageComponent,
      ),
    data: { page: 'project-settings' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/worklog',
    loadComponent: () =>
      import('./features/worklog/worklog.component').then((m) => m.WorklogComponent),
    data: { page: 'worklog' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/quick-history',
    loadComponent: () =>
      import('./features/quick-history/quick-history.component').then(
        (m) => m.QuickHistoryComponent,
      ),
    data: { page: 'quick-history' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/metrics',
    loadComponent: () =>
      import('./pages/metric-page/metric-page.component').then(
        (m) => m.MetricPageComponent,
      ),
    data: { page: 'metrics' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/daily-summary',
    loadComponent: () =>
      import('./pages/daily-summary/daily-summary.component').then(
        (m) => m.DailySummaryComponent,
      ),
    data: { page: 'daily-summary' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'project/:id/daily-summary/:dayStr',
    loadComponent: () =>
      import('./pages/daily-summary/daily-summary.component').then(
        (m) => m.DailySummaryComponent,
      ),
    data: { page: 'daily-summary' },
    canActivate: [ValidProjectIdGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'active/:subPageType',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./pages/config-page/config-page.component').then(
        (m) => m.ConfigPageComponent,
      ),
  },
  {
    path: 'active/:subPageType/:param',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./pages/config-page/config-page.component').then(
        (m) => m.ConfigPageComponent,
      ),
  },
  {
    path: 'active',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./pages/config-page/config-page.component').then(
        (m) => m.ConfigPageComponent,
      ),
  },
  {
    path: 'plugins/:pluginId/index',
    loadComponent: () =>
      import('./plugins/ui/plugin-index/plugin-index.component').then(
        (m) => m.PluginIndexComponent,
      ),
    data: { page: 'plugin-index' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'contrast-test',
    loadComponent: () =>
      import('./pages/contrast-test/contrast-test.component').then(
        (m) => m.ContrastTestComponent,
      ),
    data: { page: 'contrast-test' },
  },
  {
    path: 'donate',
    loadComponent: () =>
      import('./pages/donate-page/donate-page.component').then(
        (m) => m.DonatePageComponent,
      ),
    data: { page: 'donate' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: '**',
    canActivate: [DefaultStartPageGuard],
    component: TagTaskPageComponent,
  },
];
