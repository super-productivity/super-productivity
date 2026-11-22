import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskListComponent } from '../../tasks/task-list/task-list.component';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { AddTaskBarComponent } from '../../tasks/add-task-bar/add-task-bar.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { T } from '../../../t.const';
import { BOARD_PANEL } from './board-panel.token';
import { BoardTableHeaderComponent } from '../board-table-header/board-table-header.component';
import { TASK_TABLE, TableColId, TaskTableCfg } from '../../tasks/task-table.token';
import {
  getTableCols,
  getTableGridTemplate,
  getTableSort,
  getTableSortClickChanges,
  TableCol,
  toTaskTableCfg,
} from '../boards.util';

const isSameTaskTableCfg = (a: TaskTableCfg | null, b: TaskTableCfg | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.colIds.length === b.colIds.length &&
    a.colIds.every((id, i) => id === b.colIds[i]));

/**
 * A board panel as task rows (`task-list`), for anything stacked: the view's
 * only list, or one collapsible section of it. The rows reorder and move
 * through the panel (`VIEW_TASK_LIST`).
 */
@Component({
  selector: 'board-panel-rows',
  standalone: true,
  imports: [
    TaskListComponent,
    CollapsibleComponent,
    AddTaskBarComponent,
    NgTemplateOutlet,
    MatIcon,
    MatButton,
    MatIconButton,
    MatTooltip,
    TranslatePipe,
    MsToStringPipe,
    BoardTableHeaderComponent,
  ],
  templateUrl: './board-panel-rows.component.html',
  styleUrl: './board-panel-rows.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // This section's task rows render as table rows while this is set.
    {
      provide: TASK_TABLE,
      useFactory: () => inject(forwardRef(() => BoardPanelRowsComponent)).taskTable,
    },
  ],
  host: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '[style.--table-cols]': 'tableGrid()',
  },
})
export class BoardPanelRowsComponent {
  readonly panel = inject(BOARD_PANEL);
  protected readonly T = T;

  // Each section of a table has its own columns, widths and sort.
  // Widths while a column divider is dragged; stored once on release.
  readonly draftTableCols = signal<TableCol[] | null>(null);
  readonly tableCols = computed(
    () => this.draftTableCols() ?? getTableCols(this.panel.panelCfg()),
  );
  readonly tableSort = computed(() => getTableSort(this.panel.panelCfg()));
  readonly tableGrid = computed(() =>
    this.panel.isTableLayout() ? getTableGridTemplate(this.tableCols()) : null,
  );
  // Only the column ids reach the rows: a resize doesn't touch every row.
  readonly taskTable = computed<TaskTableCfg | null>(
    () => (this.panel.isTableLayout() ? toTaskTableCfg(this.tableCols()) : null),
    { equal: isSameTaskTableCfg },
  );

  setTableCols(cols: TableCol[]): void {
    const tableCols = cols.map(({ id, width }) =>
      id === 'title' ? { id } : { id, width },
    );
    this.panel.panelChange.emit({ ...this.panel.panelCfg(), tableCols });
  }

  sortBy(col: TableColId): void {
    const changed = getTableSortClickChanges(this.panel.panelCfg(), col);
    if (changed) this.panel.panelChange.emit(changed);
  }
}
