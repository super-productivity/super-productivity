import { Routes } from '@angular/router';

import {
  ActiveWorkContextGuard,
  DefaultStartPageGuard,
  DonatePageGuard,
  FocusOverlayOpenGuard,
  ValidProjectIdGuard,
  ValidTagIdGuard,
  FeatureEnabledGuard,
} from './app.guard';

import { TagTaskPageComponent } from './pages/tag-task-page/tag-task-page.component';

export const APP_ROUTES: Routes = [
  // Eagerly loaded — this is the main view
  {
    path: 'tag/:id/tasks',
    component: TagTaskPageComponent,
    data: { page: 'tag-tasks' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  // Tag sub-routes (worklog, history, summary, metrics)
  // Must appear after tag/:id/tasks so the more specific path matches first
  {
    path: 'tag/:id',
    canActivate: [ValidTagIdGuard],
    canActivateChild: [FocusOverlayOpenGuard],
    loadChildren: () => import('./routes/context.routes').then((m) => m.TAG_CHILD_ROUTES),
  },
  // Project routes (tasks, worklog, history, summary, metrics)
  // Shares one chunk with tag routes via context.routes.ts
  {
    path: 'project/:id',
    canActivate: [ValidProjectIdGuard],
    canActivateChild: [FocusOverlayOpenGuard],
    loadChildren: () =>
      import('./routes/context.routes').then((m) => m.PROJECT_CHILD_ROUTES),
  },
  // Standalone pages — all import from same barrel so they share one chunk
  {
    path: 'config',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
    data: { page: 'config' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.SearchPageComponent),
    data: {
      page: 'search',
      featureConfigKey: 'isSearchEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'scheduled-list',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ScheduledListPageComponent),
    data: { page: 'scheduled-list' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'planner',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.PlannerComponent),
    data: {
      page: 'planner',
      featureConfigKey: 'isPlannerEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'schedule',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.ScheduleComponent),
    data: {
      page: 'schedule',
      featureConfigKey: 'isSchedulerEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'boards',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.BoardsComponent),
    data: {
      page: 'boards',
      featureConfigKey: 'isBoardsEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'habits',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.HabitPageComponent),
    data: {
      page: 'habits',
      featureConfigKey: 'isHabitsEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'archived-projects',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ArchivedProjectsPageComponent),
    data: { page: 'archived-projects' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'donate',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.DonatePageComponent),
    data: {
      page: 'donate',
      featureConfigKey: 'isDonatePageEnabled',
    },
    canActivate: [DonatePageGuard, FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'contrast-test',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ContrastTestComponent),
    data: { page: 'contrast-test' },
  },
  {
    path: 'plugins/:pluginId/index',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.PluginIndexComponent),
    data: { page: 'plugin-index' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'active/:subPageType',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  {
    path: 'active/:subPageType/:param',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  {
    path: 'active',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  // Wildcard — redirects to default start page
  {
    path: '**',
    canActivate: [DefaultStartPageGuard],
    component: TagTaskPageComponent,
  },
];
