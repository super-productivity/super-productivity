import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { DashboardLayoutItem, BuiltinWidgetDef } from './dashboard.model';
import { PluginDashboardWidgetCfg } from '@super-productivity/plugin-api';

interface PickerData {
  items: DashboardLayoutItem[];
  builtinWidgets: BuiltinWidgetDef[];
  pluginWidgets: PluginDashboardWidgetCfg[];
}

@Component({
  selector: 'dashboard-widget-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogContent, MatDialogActions, MatButton, MatIcon, MatSlideToggle],
  template: `
    <h2>Dashboard Widgets</h2>
    <mat-dialog-content>
      <div class="widget-list">
        @for (widget of allWidgets(); track widget.id) {
          <div class="widget-row">
            <mat-icon>{{ widget.icon }}</mat-icon>
            <div class="widget-info">
              <div class="widget-name">{{ widget.label }}</div>
              @if (widget.description) {
                <div class="widget-desc">{{ widget.description }}</div>
              }
            </div>
            <mat-slide-toggle
              [checked]="isVisible(widget.id)"
              (change)="toggleWidget(widget.id)"
            ></mat-slide-toggle>
          </div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="cancel()"
      >
        Cancel
      </button>
      <button
        mat-button
        color="primary"
        (click)="save()"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 {
        padding: var(--s2) var(--s3) 0;
        margin: 0;
      }

      .widget-list {
        display: flex;
        flex-direction: column;
        min-width: 350px;
      }

      .widget-row {
        display: flex;
        align-items: center;
        gap: var(--s2);
        padding: var(--s2) 0;
        border-bottom: 1px solid var(--divider-color);
      }

      .widget-row:last-child {
        border-bottom: none;
      }

      .widget-info {
        flex: 1;
      }

      .widget-name {
        font-weight: 500;
      }

      .widget-desc {
        font-size: 0.85em;
        opacity: 0.6;
      }
    `,
  ],
})
export class DashboardWidgetPickerComponent {
  private _dialogRef = inject(MatDialogRef<DashboardWidgetPickerComponent>);
  private _data: PickerData = inject(MAT_DIALOG_DATA);

  private _items = signal<DashboardLayoutItem[]>([...this._data.items]);

  allWidgets = signal([
    ...this._data.builtinWidgets.map((w) => ({
      id: w.id,
      label: w.label,
      icon: w.icon,
      description: w.description,
    })),
    ...this._data.pluginWidgets.map((w) => ({
      id: `plugin:${w.pluginId}:${w.id}`,
      label: w.label,
      icon: w.icon || 'extension',
      description: w.description || '',
    })),
  ]);

  isVisible(widgetId: string): boolean {
    const item = this._items().find((i) => i.widgetId === widgetId);
    return item ? item.isVisible : false;
  }

  toggleWidget(widgetId: string): void {
    this._items.update((items) => {
      const existing = items.find((i) => i.widgetId === widgetId);
      if (existing) {
        return items.map((i) =>
          i.widgetId === widgetId ? { ...i, isVisible: !i.isVisible } : i,
        );
      }
      // Add new widget (plugin widget not yet in config)
      const pluginW = this._data.pluginWidgets.find(
        (w) => `plugin:${w.pluginId}:${w.id}` === widgetId,
      );
      return [
        ...items,
        {
          widgetId,
          size: pluginW?.defaultSize || 'medium',
          isVisible: true,
        },
      ];
    });
  }

  cancel(): void {
    this._dialogRef.close();
  }

  save(): void {
    this._dialogRef.close(this._items());
  }
}
