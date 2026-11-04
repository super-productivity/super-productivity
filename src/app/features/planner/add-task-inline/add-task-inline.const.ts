/**
 * The collapsed add button, which keyboard focus recovery falls back to after a
 * bulk action empties a list. Deliberately NOT just `add-task-inline button`:
 * once the inline form is expanded, that also matches buttons inside the
 * add-task-bar which replaces this one. Pinned by add-task-inline.component.spec.ts.
 *
 * Kept out of the component file so non-component callers (the bulk action
 * service, the Planner fallback helper) can read the selector without pulling
 * `AddTaskInlineComponent` — and with it `AddTaskBarComponent` — into their
 * import graph.
 */
export const ADD_TASK_INLINE_BTN_SELECTOR = 'add-task-inline [data-add-task-btn]';
