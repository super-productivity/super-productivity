import { inject, Injectable } from '@angular/core';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { TaskService } from '../../features/tasks/task.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { SnackService } from '../snack/snack.service';
import { SS } from '../persistence/storage-keys.const';
import { androidInterface } from '../../features/android/android-interface';
import { Log } from '../log';

@Injectable({ providedIn: 'root' })
export class StartupOverlayService {
  private _taskService = inject(TaskService);
  private _layoutService = inject(LayoutService);
  private _snackService = inject(SnackService);

  processAndDismiss(): void {
    if (!IS_ANDROID_WEB_VIEW) return;

    try {
      // Drain the widget task queue on cold start.
      // The processWidgetTasks$ effect in android.effects.ts only fires on
      // onResume$, which is a Subject — on cold start, onResume fires before
      // effects subscribe, so the event is lost. We must drain here.
      this._processQueuedTasks();

      // Get partial text from native overlay (overlay stays visible).
      // Returns null if bar was never opened, empty string if opened but empty,
      // or the actual text if user was typing.
      const partialText = androidInterface.getStartupOverlayPartialText?.() ?? null;

      if (partialText === null) {
        // Bar was never opened: delay dismiss until the bottom nav entrance
        // animation completes so the native add-task button stays visible
        // until the HTML FAB takes over (avoids a gap with no button).
        // 1500ms must match ENTRANCE_ANIMATION_DURATION in app.component.ts
        setTimeout(() => androidInterface.dismissStartupOverlay?.(), 1500);
      } else if (partialText.length > 0) {
        // Bar open with text: transfer text to webapp add task bar
        sessionStorage.setItem(SS.ADD_TASK_BAR_TXT, partialText);
        this._layoutService.showAddTaskBar();

        // Wait for AddTaskBar to mount, then position cursor and hide overlay.
        // The 300ms delay ensures we run AFTER AddTaskBarComponent's
        // ngAfterViewInit → focusInput(true) → 200ms setTimeout → select().
        this._waitForInput((input) => {
          setTimeout(() => {
            input.setSelectionRange(partialText.length, partialText.length);
            input.focus();
            androidInterface.hideStartupOverlay?.();
          }, 300);
        });
      } else {
        // Bar open but empty: show webapp add task bar and dismiss overlay
        this._layoutService.showAddTaskBar();
        this._waitForInput((input) => {
          setTimeout(() => {
            input.focus();
            androidInterface.hideStartupOverlay?.();
          }, 300);
        });
      }
    } catch (e) {
      Log.err('StartupOverlayService: processAndDismiss failed', e);
      androidInterface.dismissStartupOverlay?.();
    }
  }

  private _processQueuedTasks(): void {
    const queueJson = androidInterface.getWidgetTaskQueue?.();
    if (!queueJson) return;

    try {
      const queue = JSON.parse(queueJson);
      const tasks = queue.tasks || [];
      for (const task of tasks) {
        this._taskService.add(task.title);
      }

      if (tasks.length > 0) {
        this._snackService.open({
          type: 'SUCCESS',
          msg:
            tasks.length === 1
              ? 'Task added from startup'
              : `${tasks.length} tasks added from startup`,
        });
      }
    } catch (e) {
      Log.err('StartupOverlayService: Failed to process queued tasks', e);
    }
  }

  /**
   * Polls for the AddTaskBar input element using a MutationObserver,
   * with a safety timeout to prevent leaks.
   */
  private _waitForInput(callback: (input: HTMLInputElement) => void): void {
    const input = document.querySelector<HTMLInputElement>('add-task-bar.global input');
    if (input) {
      callback(input);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const el = document.querySelector<HTMLInputElement>('add-task-bar.global input');
      if (el) {
        resolved = true;
        observer.disconnect();
        callback(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety timeout — only fires if observer hasn't resolved yet
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      androidInterface.hideStartupOverlay?.();
    }, 3000);
  }
}
