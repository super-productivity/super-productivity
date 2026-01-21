import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  viewChildren,
} from '@angular/core';
import { Observable } from 'rxjs';
import { T } from '../../../t.const';
import { PlannerDay } from '../planner.model';
import { PlannerService } from '../planner.service';
import { PlannerDayComponent } from '../planner-day/planner-day.component';
import { AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { selectUndoneOverdue } from '../../tasks/store/task.selectors';
import { PlannerDayOverdueComponent } from '../planner-day-overdue/planner-day-overdue.component';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'planner-plan-view',
  templateUrl: './planner-plan-view.component.html',
  styleUrl: './planner-plan-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlannerDayComponent,
    AsyncPipe,
    PlannerDayOverdueComponent,
    MatProgressSpinner,
  ],
})
export class PlannerPlanViewComponent {
  private _plannerService = inject(PlannerService);
  private _store = inject(Store);
  private _destroyRef = inject(DestroyRef);

  overdue$ = this._store.select(selectUndoneOverdue);
  days$: Observable<PlannerDay[]> = this._plannerService.days$;
  isLoadingMore$ = this._plannerService.isLoadingMore$;

  dayElements = viewChildren(PlannerDayComponent, { read: ElementRef });

  private _intersectionObserver?: IntersectionObserver;
  private _lastObservedElement?: Element;

  protected readonly T = T;

  constructor() {
    // Setup intersection observer when day elements change
    effect(() => {
      const elements = this.dayElements();
      if (elements.length > 0) {
        this._setupIntersectionObserver(elements);
      }
    });

    // Cleanup observer on component destroy
    this._destroyRef.onDestroy(() => {
      this._intersectionObserver?.disconnect();
    });
  }

  private _setupIntersectionObserver(elements: readonly ElementRef[]): void {
    // Disconnect existing observer
    this._intersectionObserver?.disconnect();

    // Get last day element
    const lastElement = elements[elements.length - 1]?.nativeElement;

    // If no element, return early
    if (!lastElement) {
      return;
    }

    // If same element as last time, no need to recreate observer
    if (lastElement === this._lastObservedElement) {
      // Just re-observe the same element with the existing observer
      this._intersectionObserver?.observe(lastElement);
      return;
    }

    // Store the last observed element
    this._lastObservedElement = lastElement;

    // Create new IntersectionObserver
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Only trigger if:
          // 1. Entry is actually intersecting
          // 2. Not already loading
          if (entry.isIntersecting && !this._plannerService.isLoadingMore$.value) {
            // Clear the last observed element so we can observe the next one
            this._lastObservedElement = undefined;
            // Trigger loading more days
            this._plannerService.loadMoreDays();
          }
        });
      },
      {
        threshold: 0.1,
      },
    );

    // Observe the last day element
    this._intersectionObserver.observe(lastElement);
  }
}
