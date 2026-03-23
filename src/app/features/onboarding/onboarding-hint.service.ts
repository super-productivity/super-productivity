import { effect, inject, Injectable, signal } from '@angular/core';
import { ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, Subscription } from 'rxjs';
import { concatMap, first, take } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { selectActiveWorkContext } from '../work-context/store/work-context.selectors';

export type OnboardingStep = 'create-task' | 'explore';

/** How long the "explore" hint stays visible before auto-dismissing */
const EXPLORE_AUTO_DISMISS_MS = 12000;
/** Delay after add-task-bar closes before showing explore hint */
const EXPLORE_SHOW_DELAY_MS = 1000;

@Injectable({ providedIn: 'root' })
export class OnboardingHintService {
  currentStep = signal<OnboardingStep | null>(null);

  private _actions$: Observable<Action> = inject(LOCAL_ACTIONS);
  private _layoutService = inject(LayoutService);
  private _dataInitStateService = inject(DataInitStateService);
  private _store = inject(Store);
  private _isStarted = false;
  private _waitingForBarClose = false;
  private _startSub: Subscription | null = null;
  private _listenSub: Subscription | null = null;
  private _exploreShowTimeout: ReturnType<typeof setTimeout> | null = null;
  private _exploreDismissTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (localStorage.getItem(LS.ONBOARDING_HINTS_DONE)) {
      return;
    }

    // Hide create-task hint as soon as add-task-bar opens
    effect(() => {
      const isOpen = this._layoutService.isShowAddTaskBar();
      if (isOpen && this.currentStep() === 'create-task') {
        this.currentStep.set(null);
      }
      // Show explore hint after bar closes (with delay)
      if (!isOpen && this._waitingForBarClose) {
        this._waitingForBarClose = false;
        this._exploreShowTimeout = setTimeout(
          () => this._showExploreStep(),
          EXPLORE_SHOW_DELAY_MS,
        );
      }
    });

    if (localStorage.getItem(LS.ONBOARDING_PRESET_DONE)) {
      this._startOnboarding();
    }
  }

  static isOnboardingInProgress(): boolean {
    return (
      !!localStorage.getItem(LS.ONBOARDING_PRESET_DONE) &&
      !localStorage.getItem(LS.ONBOARDING_HINTS_DONE)
    );
  }

  startAfterPresetSelection(): void {
    if (localStorage.getItem(LS.ONBOARDING_HINTS_DONE)) {
      return;
    }
    this._startOnboarding();
  }

  skip(): void {
    localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
    this.currentStep.set(null);
    this._waitingForBarClose = false;
    this._startSub?.unsubscribe();
    this._listenSub?.unsubscribe();
    this._clearExploreTimeouts();
  }

  private _startOnboarding(): void {
    if (this._isStarted) {
      return;
    }
    this._isStarted = true;

    this._startSub = this._dataInitStateService.isAllDataLoadedInitially$
      .pipe(
        concatMap(() => this._store.select(selectActiveWorkContext)),
        take(1),
      )
      .subscribe((ctx) => {
        if (ctx.taskIds.length > 0) {
          // Tasks already exist (e.g. from example tasks) — skip "create-task"
          // but still show the "explore" hint
          this._showExploreStep();
        } else {
          this.currentStep.set('create-task');
          this._listenForTaskCreation();
        }
      });
  }

  private _listenForTaskCreation(): void {
    this._listenSub = this._actions$
      .pipe(ofType(TaskSharedActions.addTask), first())
      .subscribe(() => {
        this._listenSub?.unsubscribe();
        this._waitingForBarClose = true;
        // If the bar is already closed (e.g. keyboard shortcut), start the delay now
        if (!this._layoutService.isShowAddTaskBar()) {
          this._waitingForBarClose = false;
          this._exploreShowTimeout = setTimeout(
            () => this._showExploreStep(),
            EXPLORE_SHOW_DELAY_MS,
          );
        }
      });
  }

  private _showExploreStep(): void {
    this.currentStep.set('explore');
    this._exploreDismissTimeout = setTimeout(() => this.skip(), EXPLORE_AUTO_DISMISS_MS);
  }

  private _clearExploreTimeouts(): void {
    if (this._exploreShowTimeout !== null) {
      clearTimeout(this._exploreShowTimeout);
      this._exploreShowTimeout = null;
    }
    if (this._exploreDismissTimeout !== null) {
      clearTimeout(this._exploreDismissTimeout);
      this._exploreDismissTimeout = null;
    }
  }
}
