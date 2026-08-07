import {
  setCurrentTask,
  setSelectedTask,
  toggleStart,
} from '../features/tasks/store/task.actions';
import {
  addTaskRepeatCfgToTask,
  deleteTaskRepeatCfg,
  updateTaskRepeatCfg,
  upsertTaskRepeatCfg,
} from '../features/task-repeat-cfg/store/task-repeat-cfg.actions';
import {
  hideFocusOverlay,
  showFocusOverlay,
} from '../features/focus-mode/store/focus-mode.actions';
import { setActiveWorkContext } from '../features/work-context/store/work-context.actions';
import { updateGlobalConfigSection } from '../features/config/store/global-config.actions';
import {
  hideAddTaskBar,
  hideNonTaskSidePanelContent,
  hidePluginPanel,
  showAddTaskBar,
  toggleIssuePanel,
  toggleShowNotes,
} from '../core-ui/layout/store/layout.actions';

/**
 * List of NgRx actions that plugins are allowed to dispatch.
 * This provides controlled access to app functionality while preventing
 * plugins from accessing sensitive or dangerous actions.
 */
export const ALLOWED_PLUGIN_ACTIONS = [
  // Layout
  showAddTaskBar,
  hideAddTaskBar,
  toggleShowNotes,
  hideNonTaskSidePanelContent,
  toggleIssuePanel,
  hidePluginPanel,

  // Focus Mode
  showFocusOverlay,
  hideFocusOverlay,
  // startFocusSession,
  // cancelFocusSession,
  // pauseFocusSession,
  // completeFocusSession,

  // Task Management
  // addTask,
  // updateTask,
  // deleteTask,
  // moveToArchive,
  // restoreTask,
  toggleStart,
  setCurrentTask,
  setSelectedTask,
  // addSubTask,

  // Task Repeat Configuration
  // Plugins can manage recurring task templates (create/update/delete repeat
  // configs and attach them to existing tasks). Mirrors the scope of the
  // existing task-mutation actions; required for MCP-style integrations that
  // configure recurrences from outside the UI.
  addTaskRepeatCfgToTask,
  updateTaskRepeatCfg,
  upsertTaskRepeatCfg,
  deleteTaskRepeatCfg,

  // Project Management
  // addProject,
  // updateProject,
  // archiveProject,
  // unarchiveProject,

  // Tag Management
  // addTag,
  // updateTag,
  // deleteTag,

  // Note Management
  // addNote,
  // updateNote,
  // deleteNote,

  // Simple Counter
  // addSimpleCounter,
  // increaseSimpleCounterCounterToday,
  // decreaseSimpleCounterCounterToday,
  // toggleSimpleCounterCounter,

  // Work Context
  setActiveWorkContext,

  // Configuration (limited to specific sections)
  updateGlobalConfigSection,
] as const;

// Create a type for the allowed action types
export type AllowedPluginAction = (typeof ALLOWED_PLUGIN_ACTIONS)[number];

// Helper to check if an action is allowed
export const isAllowedPluginAction = (action: { type?: string }): boolean => {
  return ALLOWED_PLUGIN_ACTIONS.some(
    (allowedAction) => action.type === allowedAction.type,
  );
};
