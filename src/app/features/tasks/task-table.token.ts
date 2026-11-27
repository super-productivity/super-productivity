import { InjectionToken, Signal } from '@angular/core';

export type TableColId =
  | 'title'
  | 'project'
  | 'tags'
  | 'estimate'
  | 'timeSpent'
  | 'due'
  | 'deadline'
  | 'priority';

/**
 * What a table row shows after its title: the picked columns in order, and
 * a lookup of them so the row hides the buttons a column already shows.
 */
export interface TaskTableCfg {
  colIds: readonly TableColId[];
  has: Readonly<Partial<Record<TableColId, true>>>;
}

/**
 * Provided by a view in its table layout: task rows (and their subtask rows)
 * below it render as table rows. `null` while the view shows a plain list.
 * One signal for every row, not an input per row (task rows are a hot path).
 */
export const TASK_TABLE = new InjectionToken<Signal<TaskTableCfg | null>>('TASK_TABLE');
