import { Injectable, inject } from '@angular/core';
import { loadFromRealLs, saveToRealLs } from '../../core/persistence/local-storage';
import { LS } from '../../core/persistence/storage-keys.const';
import { DOCUMENT } from '@angular/common';
import { LocalUiHelperSettings } from './ui-helper.model';
import { UI_LOCAL_HELPER_DEFAULT } from './ui-helper.const';
import { IS_ELECTRON } from '../../app.constants';
import { fromEvent } from 'rxjs';
import { throttleTime } from 'rxjs/operators';
import { Log } from '../../core/log';

@Injectable({ providedIn: 'root' })
export class UiHelperService {
  private _document = inject<Document>(DOCUMENT);

  initElectron(): void {
    this._initMousewheelZoomForElectron();
  }

  zoomTo(zoomFactor: number): void {
    if (Number.isNaN(zoomFactor)) {
      Log.err('Invalid zoom factor', zoomFactor);
      return;
    }

    window.ea.setZoomFactor(this._zoomFactorMinMax(zoomFactor));
    this._updateLocalUiHelperSettings({ zoomFactor });
  }

  zoomBy(zoomBy: number): void {
    if (Number.isNaN(zoomBy)) {
      Log.err('Invalid zoom factor', zoomBy);
      return;
    }
    const currentZoom = window.ea.getZoomFactor();
    Log.log({ currentZoom });

    const zoomFactor = currentZoom + zoomBy;

    window.ea.setZoomFactor(this._zoomFactorMinMax(zoomFactor));
    this._updateLocalUiHelperSettings({ zoomFactor });
  }

  focusApp(): void {
    if (IS_ELECTRON) {
      //  otherwise the last focused task gets focused again leading to unintended keyboard events
      if (document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }

      window.ea.showOrFocus();
    } else {
      Log.err('Cannot execute focus app window in browser');
    }
  }

  /**
   * Focus app after a delay to prevent accidental input.
   * Used for "surprise" focus scenarios (tracking reminder, idle, take-a-break)
   * where user might still be typing in another app.
   *
   * The 1500ms delay gives users time to finish typing after notification appears.
   * Based on user feedback in issue #5762 where immediate focus caused unintended input.
   */
  focusAppAfterNotification(): void {
    if (!IS_ELECTRON) {
      return;
    }

    // Delay focus to prevent accidental input if user is typing in another app.
    // 1500ms gives users time to finish typing after notification appears.
    const FOCUS_DELAY_MS = 1500;
    // Small delay after focus to let window activation complete before blurring
    const BLUR_DELAY_MS = 100;

    setTimeout(() => {
      window.ea.showOrFocus();
      // Blur after focus to prevent any task input from receiving keystrokes
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) {
          (document.activeElement as HTMLElement).blur();
        }
      }, BLUR_DELAY_MS);
    }, FOCUS_DELAY_MS);
  }

  private _zoomFactorMinMax(zoomFactor: number): number {
    zoomFactor = Math.min(Math.max(zoomFactor, 0.1), 4);
    zoomFactor = Math.round(zoomFactor * 1000) / 1000;
    return zoomFactor;
  }

  private _initMousewheelZoomForElectron(): void {
    const ZOOM_DELTA = 0.025;

    // set initial zoom
    this.zoomTo(this._getLocalUiHelperSettings().zoomFactor);

    fromEvent(this._document, 'mousewheel')
      .pipe(throttleTime(20))
      .subscribe((event: any) => {
        if (event && event.ctrlKey) {
          // this does not prevent scrolling unfortunately
          // event.preventDefault();

          let zoomFactor = window.ea.getZoomFactor();
          if (event.deltaY > 0) {
            zoomFactor -= ZOOM_DELTA;
          } else if (event.deltaY < 0) {
            zoomFactor += ZOOM_DELTA;
          }
          this.zoomTo(zoomFactor);
        }
      });
  }

  private _getLocalUiHelperSettings(): LocalUiHelperSettings {
    return (
      (loadFromRealLs(LS.LOCAL_UI_HELPER) as LocalUiHelperSettings) ||
      UI_LOCAL_HELPER_DEFAULT
    );
  }

  private _updateLocalUiHelperSettings(newCfg: Partial<LocalUiHelperSettings>): void {
    saveToRealLs(LS.LOCAL_UI_HELPER, {
      ...this._getLocalUiHelperSettings(),
      ...newCfg,
    });
  }
}
