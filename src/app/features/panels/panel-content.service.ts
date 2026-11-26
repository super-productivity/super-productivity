import { Injectable, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  INITIAL_LAYOUT_STATE,
  selectLayoutFeatureState,
} from '../../core-ui/layout/store/layout.reducer';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../tasks/task.service';
import { TaskDetailTargetPanel } from '../tasks/task.model';

export type PanelContentType =
  | 'NOTES'
  | 'TASK'
  | 'ADD_TASK_PANEL'
  | 'ISSUE_PANEL'
  | 'PLUGIN'
  | 'SCHEDULE_DAY_PANEL';

@Injectable({ providedIn: 'root' })
export class PanelContentService {
  private _taskService = inject(TaskService);
  private _store = inject(Store);

  private readonly _selectedTask = toSignal(this._taskService.selectedTask$, {
    initialValue: null,
  });

  private readonly _taskDetailPanelTargetPanel = toSignal(
    this._taskService.taskDetailPanelTargetPanel$,
    { initialValue: null },
  );

  private readonly _layoutFeatureState = toSignal(
    this._store.select(selectLayoutFeatureState),
    {
      initialValue: INITIAL_LAYOUT_STATE,
    },
  );

  readonly panelType = computed<PanelContentType | null>(() => {
    const layoutState = this._layoutFeatureState();
    const selectedTask = this._selectedTask();
    if (!layoutState) return null;

    const { isShowNotes, isShowIssuePanel, isShowPluginPanel, isShowScheduleDayPanel } =
      layoutState;

    if (isShowNotes) return 'NOTES';
    if (isShowIssuePanel) return 'ISSUE_PANEL';
    if (isShowPluginPanel) return 'PLUGIN';
    if (isShowScheduleDayPanel) return 'SCHEDULE_DAY_PANEL';
    if (selectedTask) return 'TASK';
    return null;
  });

  readonly hasContent = computed<boolean>(() => {
    const layoutState = this._layoutFeatureState();
    const selectedTask = this._selectedTask();
    if (!layoutState) return false;
    const { isShowNotes, isShowIssuePanel, isShowPluginPanel, isShowScheduleDayPanel } =
      layoutState;
    return !!(
      selectedTask ||
      isShowNotes ||
      isShowIssuePanel ||
      isShowPluginPanel ||
      isShowScheduleDayPanel
    );
  });

  readonly canOpen = computed<boolean>(() => {
    const target = this._taskDetailPanelTargetPanel();
    return this.hasContent() && target !== TaskDetailTargetPanel.DONT_OPEN_PANEL;
  });

  getCurrentPanelType(): PanelContentType | null {
    return this.panelType();
  }

  getHasContent(): boolean {
    return this.hasContent();
  }

  getCanOpen(): boolean {
    return this.canOpen();
  }
}
