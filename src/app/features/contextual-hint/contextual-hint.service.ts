import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GlobalConfigService } from '../config/global-config.service';
import { ShepherdService } from '../shepherd/shepherd.service';
import {
  ContextualHint,
  ContextualHintState,
  CONTEXTUAL_HINT_STATE_VERSION,
} from './contextual-hint.model';
import { CONTEXTUAL_HINTS, HINT_IDS } from './contextual-hints.const';
import { LS } from '../../core/persistence/storage-keys.const';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { IS_MOUSE_PRIMARY } from '../../util/is-mouse-primary';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { selectIsOverlayShown } from '../focus-mode/store/focus-mode.selectors';
import { Log } from '../../core/log';

@Injectable({ providedIn: 'root' })
export class ContextualHintService {
  private _store = inject(Store);
  private _router = inject(Router);
  private _globalConfigService = inject(GlobalConfigService);
  private _shepherdService = inject(ShepherdService);
  private _dataInitStateService = inject(DataInitStateService);

  activeHint = signal<ContextualHint | null>(null);

  async evaluate(): Promise<void> {
    // Wait for store hydration before checking triggers
    await firstValueFrom(this._dataInitStateService.isAllDataLoadedInitially$);

    // Don't show hints during focus mode
    let isFocusMode = false;
    this._store
      .select(selectIsOverlayShown)
      .pipe(take(1))
      .subscribe((val) => (isFocusMode = val));
    if (isFocusMode) return;

    const state = this._loadState();

    for (const hint of CONTEXTUAL_HINTS) {
      if (state.dismissed.includes(hint.id)) {
        continue;
      }
      const impressions = state.impressions[hint.id] || 0;
      if (impressions >= hint.maxImpressions) {
        continue;
      }
      if (this._checkTrigger(hint.id)) {
        state.impressions[hint.id] = impressions + 1;
        this._saveState(state);
        this.activeHint.set(hint);
        return;
      }
    }
  }

  dismiss(): void {
    const hint = this.activeHint();
    if (!hint) return;
    const state = this._loadState();
    if (!state.dismissed.includes(hint.id)) {
      state.dismissed.push(hint.id);
    }
    this._saveState(state);
    this.activeHint.set(null);
  }

  handleAction(): void {
    const hint = this.activeHint();
    if (!hint) return;

    if (hint.actionRoute) {
      this._router.navigateByUrl(hint.actionRoute);
    } else if (hint.actionTourId) {
      this._shepherdService.show(hint.actionTourId);
    }

    this.dismiss();
  }

  private _checkTrigger(hintId: string): boolean {
    switch (hintId) {
      case HINT_IDS.SYNC_SETUP:
        return this._checkSyncSetup();
      case HINT_IDS.KEYBOARD_SHORTCUTS:
        return this._checkKeyboardShortcuts();
      default:
        return false;
    }
  }

  private _checkSyncSetup(): boolean {
    const appStarts = +(localStorage.getItem(LS.APP_START_COUNT) || 0);
    if (appStarts < 5) return false;
    const syncCfg = this._globalConfigService.sync();
    return !syncCfg?.syncProvider;
  }

  private _checkKeyboardShortcuts(): boolean {
    // Keyboard shortcuts are irrelevant on touch-primary devices
    if (!IS_MOUSE_PRIMARY) return false;
    const appStarts = +(localStorage.getItem(LS.APP_START_COUNT) || 0);
    if (appStarts < 7) return false;
    let taskCount = 0;
    this._store
      .select(selectAllTasks)
      .pipe(take(1))
      .subscribe((tasks) => (taskCount = tasks.length));
    return taskCount >= 10;
  }

  private _loadState(): ContextualHintState {
    try {
      const raw = localStorage.getItem(LS.CONTEXTUAL_HINTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          parsed.version === CONTEXTUAL_HINT_STATE_VERSION &&
          Array.isArray(parsed.dismissed) &&
          typeof parsed.impressions === 'object' &&
          parsed.impressions !== null
        ) {
          return parsed as ContextualHintState;
        }
      }
    } catch {
      // ignore parse errors
    }
    return {
      version: CONTEXTUAL_HINT_STATE_VERSION,
      dismissed: [],
      impressions: {},
    };
  }

  private _saveState(state: ContextualHintState): void {
    try {
      localStorage.setItem(LS.CONTEXTUAL_HINTS, JSON.stringify(state));
    } catch (e) {
      Log.warn('ContextualHintService: failed to save state', e);
    }
  }
}
