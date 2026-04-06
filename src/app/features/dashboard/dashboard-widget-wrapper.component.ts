import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { DashboardWidgetSize } from '@super-productivity/plugin-api';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { CdkDragHandle } from '@angular/cdk/drag-drop';

@Component({
  selector: 'dashboard-widget-wrapper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatIconButton, MatMenuModule, CdkDragHandle],
  template: `
    <div
      class="widget-header"
      cdkDragHandle
    >
      @if (icon) {
        <mat-icon class="widget-icon">{{ icon }}</mat-icon>
      }
      <span class="widget-label">{{ label }}</span>
      <span class="spacer"></span>
      <button
        mat-icon-button
        [matMenuTriggerFor]="widgetMenu"
        class="menu-btn"
      >
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #widgetMenu="matMenu">
        <button
          mat-menu-item
          (click)="sizeChange.emit('small')"
        >
          <mat-icon>crop_square</mat-icon>
          <span>Small</span>
        </button>
        <button
          mat-menu-item
          (click)="sizeChange.emit('medium')"
        >
          <mat-icon>crop_landscape</mat-icon>
          <span>Medium</span>
        </button>
        <button
          mat-menu-item
          (click)="sizeChange.emit('large')"
        >
          <mat-icon>crop_free</mat-icon>
          <span>Large</span>
        </button>
        <button
          mat-menu-item
          (click)="hide.emit()"
        >
          <mat-icon>visibility_off</mat-icon>
          <span>Hide</span>
        </button>
      </mat-menu>
    </div>
    <div class="widget-content">
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        background: var(--card-bg);
        border-radius: var(--card-border-radius, 8px);
        overflow: hidden;
        min-height: 0;
        box-shadow: var(--card-shadow, 0 1px 3px rgba(0, 0, 0, 0.12));
      }

      .widget-header {
        display: flex;
        align-items: center;
        padding: var(--s) var(--s2);
        cursor: grab;
        gap: var(--s);
        border-bottom: 1px solid var(--divider-color);
      }

      .widget-header:active {
        cursor: grabbing;
      }

      .widget-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        opacity: 0.7;
      }

      .widget-label {
        font-size: 0.85em;
        font-weight: 500;
        opacity: 0.8;
      }

      .spacer {
        flex: 1;
      }

      .menu-btn {
        opacity: 0.4;
        transition: opacity 0.2s;
      }

      :host:hover .menu-btn {
        opacity: 0.8;
      }

      .widget-content {
        flex: 1;
        overflow: auto;
      }
    `,
  ],
})
export class DashboardWidgetWrapperComponent {
  @Input() label = '';
  @Input() icon = '';
  @Input() size: DashboardWidgetSize = 'medium';
  @Output() sizeChange = new EventEmitter<DashboardWidgetSize>();
  @Output() hide = new EventEmitter<void>();
}
