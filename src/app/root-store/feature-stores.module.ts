import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import {
  LAYOUT_FEATURE_NAME,
  layoutReducer,
} from '../core-ui/layout/store/layout.reducer';
import { LayoutEffects } from '../core-ui/layout/store/layout.effects';
import {
  CONFIG_FEATURE_NAME,
  globalConfigReducer,
} from '../features/config/store/global-config.reducer';
import { GlobalConfigEffects } from '../features/config/store/global-config.effects';
import {
  FOCUS_MODE_FEATURE_KEY,
  focusModeReducer,
} from '../features/focus-mode/store/focus-mode.reducer';
import { FocusModeEffects } from '../features/focus-mode/store/focus-mode.effects';
import { IDLE_FEATURE_KEY, idleReducer } from '../features/idle/store/idle.reducer';
import { IdleEffects } from '../features/idle/store/idle.effects';
import { issueProvidersFeature } from '../features/issue/store/issue-provider.reducer';
import { PollToBacklogEffects } from '../features/issue/store/poll-to-backlog.effects';
import { PollIssueUpdatesEffects } from '../features/issue/store/poll-issue-updates.effects';
import {
  METRIC_FEATURE_NAME,
  metricReducer,
} from '../features/metric/store/metric.reducer';
import { NOTE_FEATURE_NAME, noteReducer } from '../features/note/store/note.reducer';
import { NoteEffects } from '../features/note/store/note.effects';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../features/project/store/project.reducer';
import { ProjectEffects } from '../features/project/store/project.effects';
import {
  menuTreeFeatureKey,
  menuTreeReducer,
} from '../features/menu-tree/store/menu-tree.reducer';
import {
  SIMPLE_COUNTER_FEATURE_NAME,
  simpleCounterReducer,
} from '../features/simple-counter/store/simple-counter.reducer';
import { SimpleCounterEffects } from '../features/simple-counter/store/simple-counter.effects';
import { TAG_FEATURE_NAME, tagReducer } from '../features/tag/store/tag.reducer';
import { TagEffects } from '../features/tag/store/tag.effects';
import {
  TASK_REPEAT_CFG_FEATURE_NAME,
  taskRepeatCfgReducer,
} from '../features/task-repeat-cfg/store/task-repeat-cfg.reducer';
import { TaskRepeatCfgEffects } from '../features/task-repeat-cfg/store/task-repeat-cfg.effects';
import { TaskDueEffects } from '../features/tasks/store/task-due.effects';
import { TASK_FEATURE_NAME, taskReducer } from '../features/tasks/store/task.reducer';
import { TaskInternalEffects } from '../features/tasks/store/task-internal.effects';
import { TaskRelatedModelEffects } from '../features/tasks/store/task-related-model.effects';
import { TaskReminderEffects } from '../features/tasks/store/task-reminder.effects';
import { TaskUiEffects } from '../features/tasks/store/task-ui.effects';
import { ShortSyntaxEffects } from '../features/tasks/store/short-syntax.effects';
import { IS_ELECTRON } from '../app.constants';
import { TaskElectronEffects } from '../features/tasks/store/task-electron.effects';
import { WORK_CONTEXT_FEATURE_NAME } from '../features/work-context/store/work-context.selectors';
import { workContextReducer } from '../features/work-context/store/work-context.reducer';
import { WorkContextEffects } from '../features/work-context/store/work-context.effects';
import { IS_ANDROID_WEB_VIEW } from '../util/is-android-web-view';
import { AndroidEffects } from '../features/android/store/android.effects';
import { AndroidFocusModeEffects } from '../features/android/store/android-focus-mode.effects';
import { AndroidForegroundTrackingEffects } from '../features/android/store/android-foreground-tracking.effects';
import { CaldavIssueEffects } from '../features/issue/providers/caldav/caldav-issue.effects';
import { CalendarIntegrationEffects } from '../features/calendar-integration/store/calendar-integration.effects';
import { ElectronEffects } from '../core/electron/electron.effects';
import { DominaModeEffects } from '../features/domina-mode/store/domina-mode.effects';
import { DropboxEffects } from '../imex/sync/dropbox/store/dropbox.effects';
import { FinishDayBeforeCloseEffects } from '../features/finish-day-before-close/finish-day-before-close.effects';
import { GitlabIssueEffects } from '../features/issue/providers/gitlab/gitlab-issue.effects';
import { JiraIssueEffects } from '../features/issue/providers/jira/jira-issue.effects';
import { OpenProjectEffects } from '../features/issue/providers/open-project/open-project.effects';
import { ReminderCountdownEffects } from '../features/reminder/store/reminder-countdown.effects';
import { SyncEffects } from '../imex/sync/sync.effects';
import { boardsFeature } from '../features/boards/store/boards.reducer';
import { timeTrackingFeature } from '../features/time-tracking/store/time-tracking.reducer';
import { ArchiveOperationHandlerEffects } from '../op-log/apply/archive-operation-handler.effects';
import { plannerFeature } from '../features/planner/store/planner.reducer';
import { PlannerEffects } from '../features/planner/store/planner.effects';
import { AppStateEffects } from './app-state/app-state.effects';
import { appStateFeature } from './app-state/app-state.reducer';
import { PluginHooksEffects } from '../plugins/plugin-hooks.effects';
import { OperationLogEffects } from '../op-log/capture/operation-log.effects';
import {
  PLUGIN_USER_DATA_FEATURE_NAME,
  pluginUserDataReducer,
} from '../plugins/store/plugin-user-data.reducer';
import {
  PLUGIN_METADATA_FEATURE_NAME,
  pluginMetadataReducer,
} from '../plugins/store/plugin-metadata.reducer';
import {
  REMINDER_FEATURE_NAME,
  reminderReducer,
} from '../features/reminder/store/reminder.reducer';
@NgModule({
  declarations: [],
  imports: [
    EffectsModule.forFeature([OperationLogEffects]),

    StoreModule.forFeature(appStateFeature),
    EffectsModule.forFeature([AppStateEffects]),

    StoreModule.forFeature(LAYOUT_FEATURE_NAME, layoutReducer),
    EffectsModule.forFeature([LayoutEffects]),

    StoreModule.forFeature(CONFIG_FEATURE_NAME, globalConfigReducer),
    EffectsModule.forFeature([GlobalConfigEffects]),

    StoreModule.forFeature(FOCUS_MODE_FEATURE_KEY, focusModeReducer),
    EffectsModule.forFeature([FocusModeEffects]),

    StoreModule.forFeature(IDLE_FEATURE_KEY, idleReducer),
    EffectsModule.forFeature([IdleEffects]),

    StoreModule.forFeature(issueProvidersFeature),
    EffectsModule.forFeature([PollToBacklogEffects, PollIssueUpdatesEffects]),

    StoreModule.forFeature(METRIC_FEATURE_NAME, metricReducer),

    StoreModule.forFeature(NOTE_FEATURE_NAME, noteReducer),
    EffectsModule.forFeature([NoteEffects]),

    StoreModule.forFeature(PROJECT_FEATURE_NAME, projectReducer),
    EffectsModule.forFeature([ProjectEffects]),

    StoreModule.forFeature(menuTreeFeatureKey, menuTreeReducer),

    StoreModule.forFeature(SIMPLE_COUNTER_FEATURE_NAME, simpleCounterReducer),
    EffectsModule.forFeature([SimpleCounterEffects]),

    StoreModule.forFeature(TAG_FEATURE_NAME, tagReducer),
    EffectsModule.forFeature([TagEffects]),

    StoreModule.forFeature(TASK_REPEAT_CFG_FEATURE_NAME, taskRepeatCfgReducer),
    EffectsModule.forFeature([TaskRepeatCfgEffects]),

    StoreModule.forFeature(TASK_FEATURE_NAME, taskReducer),
    EffectsModule.forFeature([
      TaskInternalEffects,
      TaskRelatedModelEffects,
      TaskReminderEffects,
      TaskUiEffects,
      ShortSyntaxEffects,
      TaskDueEffects,
      ...(IS_ELECTRON ? [TaskElectronEffects] : []),
    ]),

    StoreModule.forFeature(WORK_CONTEXT_FEATURE_NAME, workContextReducer),
    EffectsModule.forFeature([WorkContextEffects]),

    StoreModule.forFeature(boardsFeature),

    StoreModule.forFeature(timeTrackingFeature),
    EffectsModule.forFeature([ArchiveOperationHandlerEffects]),

    StoreModule.forFeature(plannerFeature),
    EffectsModule.forFeature([PlannerEffects]),

    StoreModule.forFeature(PLUGIN_USER_DATA_FEATURE_NAME, pluginUserDataReducer),
    StoreModule.forFeature(PLUGIN_METADATA_FEATURE_NAME, pluginMetadataReducer),
    StoreModule.forFeature(REMINDER_FEATURE_NAME, reminderReducer),

    // EFFECTS ONLY
    EffectsModule.forFeature([
      ...(IS_ANDROID_WEB_VIEW
        ? [AndroidEffects, AndroidFocusModeEffects, AndroidForegroundTrackingEffects]
        : []),
    ]),
    EffectsModule.forFeature([CaldavIssueEffects]),
    EffectsModule.forFeature([CalendarIntegrationEffects]),
    EffectsModule.forFeature([ElectronEffects]),
    EffectsModule.forFeature([DominaModeEffects]),
    EffectsModule.forFeature([DropboxEffects]),
    EffectsModule.forFeature([FinishDayBeforeCloseEffects]),
    EffectsModule.forFeature([GitlabIssueEffects]),
    EffectsModule.forFeature([JiraIssueEffects]),
    EffectsModule.forFeature([OpenProjectEffects]),
    EffectsModule.forFeature([ReminderCountdownEffects]),
    EffectsModule.forFeature([SyncEffects]),
    EffectsModule.forFeature([PluginHooksEffects]),
  ],
})
export class FeatureStoresModule {}
