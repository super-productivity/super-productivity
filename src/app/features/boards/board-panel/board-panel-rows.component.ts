import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
  ],
  templateUrl: './board-panel-rows.component.html',
  styleUrl: './board-panel-rows.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPanelRowsComponent {
  readonly panel = inject(BOARD_PANEL);
  protected readonly T = T;
}
