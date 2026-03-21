import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { GlobalConfigService } from '../config/global-config.service';
import { ShepherdService } from '../shepherd/shepherd.service';
import { ContextualHint, ContextualHintState } from './contextual-hint.model';
import { CONTEXTUAL_HINTS, HINT_IDS } from './contextual-hints.const';
import { TourId } from '../shepherd/shepherd-steps.const';
import { LS } from '../../core/persistence/storage-keys.const';
import { selectAllTasks } from '../tasks/store/task.selectors';

const DEFAULT_STATE: ContextualHintState = { dismissed: [], impressions: {} };

@Injectable({ providedIn: 'root' })
export class ContextualHintService {
  private _store = inject(Store);
  private _router = inject(Router);
  private _globalConfigService = inject(GlobalConfigService);
  private _shepherdService = inject(ShepherdService);

  activeHint = signal<ContextualHint | null>(null);

  evaluate(): void {
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
        this._recordImpression(hint.id);
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
      this._shepherdService.show(hint.actionTourId as TourId);
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
    const appStarts = +(localStorage.getItem(LS.APP_START_COUNT) || 0);
    if (appStarts < 3) return false;
    let taskCount = 0;
    this._store
      .select(selectAllTasks)
      .pipe(take(1))
      .subscribe((tasks) => (taskCount = tasks.length));
    return taskCount >= 10;
  }

  private _recordImpression(hintId: string): void {
    const state = this._loadState();
    state.impressions[hintId] = (state.impressions[hintId] || 0) + 1;
    this._saveState(state);
  }

  private _loadState(): ContextualHintState {
    try {
      const raw = localStorage.getItem(LS.CONTEXTUAL_HINTS);
      if (raw) {
        return JSON.parse(raw) as ContextualHintState;
      }
    } catch {
      // ignore parse errors
    }
    return { ...DEFAULT_STATE, dismissed: [], impressions: {} };
  }

  private _saveState(state: ContextualHintState): void {
    localStorage.setItem(LS.CONTEXTUAL_HINTS, JSON.stringify(state));
  }
}
