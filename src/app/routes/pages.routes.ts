export { ArchivedProjectsPageComponent } from '../pages/archived-projects-page/archived-projects-page.component';
export { ConfigPageComponent } from '../pages/config-page/config-page.component';
export { SearchPageComponent } from '../pages/search-page/search-page.component';
export { ScheduledListPageComponent } from '../pages/scheduled-list-page/scheduled-list-page.component';
export { PlannerComponent } from '../features/planner/planner.component';
export { ScheduleComponent } from '../features/schedule/schedule/schedule.component';
export { BoardsComponent } from '../features/boards/boards.component';
export { HabitPageComponent } from '../pages/habit-page/habit-page.component';
export { AllTasksPageComponent as AllTasksComponent } from '../features/all-tasks-page/all-tasks-page.component';
export { DonatePageComponent } from '../pages/donate-page/donate-page.component';
export { ContrastTestComponent } from '../pages/contrast-test/contrast-test.component';
export { PluginIndexComponent } from '../plugins/ui/plugin-index/plugin-index.component';
// Dialogs opened from always-rendered header buttons. Importing them through
// this (preloaded) barrel keeps their code in the existing pages chunk; a
// separate dynamic import would split shared deps into extra startup chunks.
export { DialogFocusSessionEditComponent } from '../features/metric/dialog-focus-session-edit/dialog-focus-session-edit.component';
export { DialogSimpleCounterEditComponent } from '../features/simple-counter/dialog-simple-counter-edit/dialog-simple-counter-edit.component';
