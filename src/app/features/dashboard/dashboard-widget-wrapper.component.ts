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
      class="drag-handle"
      cdkDragHandle
    ></div>
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
    <ng-content></ng-content>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        background: var(--card-bg);
        border-radius: var(--card-border-radius, 4px);
        overflow: hidden;
        min-height: 0;
        box-shadow: var(--card-shadow);
      }

      .drag-handle {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: var(--s2);
        cursor: grab;
        z-index: 1;
      }

      .drag-handle:active {
        cursor: grabbing;
      }

      .menu-btn {
        position: absolute;
        top: var(--s-quarter);
        right: var(--s-quarter);
        z-index: 2;
        opacity: 0;
        transition: opacity var(--transition-duration-s);
        width: 28px;
        height: 28px;
        line-height: 28px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      :host:hover .menu-btn {
        opacity: 0.6;
      }

      .menu-btn:focus,
      .menu-btn:active {
        opacity: 0.8;
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
