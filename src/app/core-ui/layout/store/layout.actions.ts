import { createAction } from '@ngrx/store';

export const showAddTaskBar = createAction('[Layout] Show AddTaskBar');

export const hideAddTaskBar = createAction('[Layout] Hide AddTaskBar');

export const toggleShowNotes = createAction('[Layout] ToggleShow Notes');

export const hideNonTaskSidePanelContent = createAction(
  '[Layout] Hide Non-Task Side Panel',
);

export const toggleIssuePanel = createAction('[Layout] Toggle IssuePanel');

export const hideIssuePanel = createAction('[Layout] Hide IssuePanel');

export const showPluginPanel = createAction(
  '[Layout] Show PluginPanel',
  (pluginId: string) => ({ pluginId }),
);

export const hidePluginPanel = createAction('[Layout] Hide PluginPanel');

export const togglePluginPanel = createAction(
  '[Layout] Toggle PluginPanel',
  (pluginId: string) => ({ pluginId }),
);

// Schedule Day Panel
export const toggleScheduleDayPanel = createAction('[Layout] Toggle ScheduleDayPanel');

export const hideScheduleDayPanel = createAction('[Layout] Hide ScheduleDayPanel');
