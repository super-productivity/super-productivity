import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDragDrop, CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { DashboardWidgetSize } from '@super-productivity/plugin-api';
import { selectDashboardConfig } from '../config/store/global-config.reducer';
import { updateGlobalConfigSection } from '../config/store/global-config.actions';
import {
  BUILTIN_WIDGET_IDS,
  DashboardLayoutItem,
  MobileWidgetSize,
  TaskListWidgetConfig,
} from './dashboard.model';
import {
  BUILTIN_WIDGETS,
  DEFAULT_MOBILE_SIZES,
  WIDGET_SIZE_COL_SPAN,
} from './dashboard.const';
import { DashboardWidgetWrapperComponent } from './dashboard-widget-wrapper.component';
import { CurrentTaskWidgetComponent } from './widgets/current-task-widget.component';
import { TodaySummaryWidgetComponent } from './widgets/today-summary-widget.component';
import { FocusModeWidgetComponent } from './widgets/focus-mode-widget.component';
import { ProductivityStreakWidgetComponent } from './widgets/productivity-streak-widget.component';
import { RecentActivityWidgetComponent } from './widgets/recent-activity-widget.component';
import { TaskListWidgetComponent } from './widgets/task-list-widget.component';
import { NotesWidgetComponent } from './widgets/notes-widget.component';
import { PluginDashboardWidgetComponent } from './plugin-dashboard-widget.component';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { moveItemInArray } from '../../util/move-item-in-array';

@Component({
  selector: 'dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDrag,
    CdkDropList,
    MatIcon,
    MatButton,
    DashboardWidgetWrapperComponent,
    CurrentTaskWidgetComponent,
    TodaySummaryWidgetComponent,
    FocusModeWidgetComponent,
    ProductivityStreakWidgetComponent,
    RecentActivityWidgetComponent,
    TaskListWidgetComponent,
    NotesWidgetComponent,
    PluginDashboardWidgetComponent,
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
})
export class DashboardPageComponent {
  private _store = inject(Store);
  private _pluginBridge = inject(PluginBridgeService);
  private _dialog = inject(MatDialog);

  private _dashboardConfig = toSignal(this._store.select(selectDashboardConfig));
  private _pluginWidgets = this._pluginBridge.dashboardWidgets;

  isEditMode = signal(false);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth < 960);

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(window.innerWidth < 960);
  }

  visibleItems = computed(() => {
    const config = this._dashboardConfig();
    if (!config) {
      return [];
    }
    const mobile = this.isMobile();
    return config.items.filter((item) => {
      if (!item.isVisible) {
        return false;
      }
      if (mobile) {
        const mSize = this._getMobileSize(item);
        return mSize !== 'hidden';
      }
      return true;
    });
  });

  widgetMeta = computed(() => {
    const builtinMap = new Map(BUILTIN_WIDGETS.map((w) => [w.id, w]));
    const pluginMap = new Map(
      this._pluginWidgets().map((w) => [`plugin:${w.pluginId}:${w.id}`, w]),
    );
    return { builtinMap, pluginMap };
  });

  getWidgetLabel(widgetId: string): string {
    const { builtinMap, pluginMap } = this.widgetMeta();
    return builtinMap.get(widgetId)?.label || pluginMap.get(widgetId)?.label || widgetId;
  }

  getWidgetIcon(widgetId: string): string {
    const { builtinMap, pluginMap } = this.widgetMeta();
    return builtinMap.get(widgetId)?.icon || pluginMap.get(widgetId)?.icon || 'extension';
  }

  getColSpan(size: DashboardWidgetSize): number {
    return WIDGET_SIZE_COL_SPAN[size] || 2;
  }

  getPluginId(widgetId: string): string {
    // widgetId format: "plugin:<pluginId>:<widgetId>"
    const parts = widgetId.split(':');
    return parts.length >= 2 ? parts[1] : '';
  }

  onDrop(event: CdkDragDrop<DashboardLayoutItem[]>): void {
    const config = this._dashboardConfig();
    if (!config) {
      return;
    }
    const visibleIds = this.visibleItems().map((i) => i.widgetId);
    const items = [...config.items];
    const fromId = visibleIds[event.previousIndex];
    const toId = visibleIds[event.currentIndex];
    const fromIdx = items.findIndex((i) => i.widgetId === fromId);
    const toIdx = items.findIndex((i) => i.widgetId === toId);
    if (fromIdx >= 0 && toIdx >= 0) {
      moveItemInArray(items, fromIdx, toIdx);
      this._updateConfig(items);
    }
  }

  onSizeChange(widgetId: string, size: DashboardWidgetSize): void {
    const config = this._dashboardConfig();
    if (!config) {
      return;
    }
    const items = config.items.map((item) =>
      item.widgetId === widgetId ? { ...item, size } : item,
    );
    this._updateConfig(items);
  }

  onHide(widgetId: string): void {
    const config = this._dashboardConfig();
    if (!config) {
      return;
    }
    const items = config.items.map((item) =>
      item.widgetId === widgetId ? { ...item, isVisible: false } : item,
    );
    this._updateConfig(items);
  }

  onTaskListConfigChange(taskListConfig: TaskListWidgetConfig): void {
    const config = this._dashboardConfig();
    if (!config) {
      return;
    }
    const items = config.items.map((item) =>
      item.widgetId === BUILTIN_WIDGET_IDS.TASK_LIST ? { ...item, taskListConfig } : item,
    );
    this._updateConfig(items);
  }

  async openWidgetPicker(): Promise<void> {
    const { DashboardWidgetPickerComponent } =
      await import('./dashboard-widget-picker.component');
    const config = this._dashboardConfig();
    if (!config) {
      return;
    }
    const dialogRef = this._dialog.open(DashboardWidgetPickerComponent, {
      data: {
        items: config.items,
        builtinWidgets: BUILTIN_WIDGETS,
        pluginWidgets: this._pluginWidgets(),
      },
    });
    dialogRef.afterClosed().subscribe((result: DashboardLayoutItem[] | undefined) => {
      if (result) {
        this._updateConfig(result);
      }
    });
  }

  toggleEditMode(): void {
    this.isEditMode.update((v) => !v);
  }

  private _getMobileSize(item: DashboardLayoutItem): MobileWidgetSize {
    return item.mobileSize ?? DEFAULT_MOBILE_SIZES[item.widgetId] ?? item.size;
  }

  private _updateConfig(items: DashboardLayoutItem[]): void {
    this._store.dispatch(
      updateGlobalConfigSection({
        sectionKey: 'dashboard',
        sectionCfg: { items },
        isSkipSnack: true,
      }),
    );
  }
}
