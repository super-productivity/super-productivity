import { inject, Injectable } from '@angular/core';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { SS } from '../persistence/storage-keys.const';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { androidInterface } from '../../features/android/android-interface';
import { Log } from '../log';

@Injectable({ providedIn: 'root' })
export class StartupOverlayService {
  private _layoutService = inject(LayoutService);

  processAndDismiss(): void {
    if (!IS_ANDROID_WEB_VIEW) return;

    try {
      // Tasks submitted through the overlay are imported from the native
      // capture inbox by AndroidEffects.importNativeCaptures$.

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

  /**
   * Polls for the AddTaskBar input element using a MutationObserver,
   * with a safety timeout to prevent leaks.
   */
  private _waitForInput(callback: (input: HTMLTextAreaElement) => void): void {
    // The title field is a <textarea class="main-input"> — an `input` type
    // selector would not match it, so target the class (mirrors the e2e locator).
    const input = document.querySelector<HTMLTextAreaElement>(
      'add-task-bar.global .main-input',
    );
    if (input) {
      callback(input);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const el = document.querySelector<HTMLTextAreaElement>(
        'add-task-bar.global .main-input',
      );
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
