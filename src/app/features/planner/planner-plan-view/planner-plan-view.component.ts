import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
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
  private _elRef = inject(ElementRef);

  overdue$ = this._store.select(selectUndoneOverdue);
  days$: Observable<PlannerDay[]> = this._plannerService.days$;
  isLoadingMore$ = this._plannerService.isLoadingMore$;

  dayElements = viewChildren(PlannerDayComponent, { read: ElementRef });

  private _intersectionObserver?: IntersectionObserver;
  private _lastObservedElement?: Element;

  private _visibleDayObserver?: IntersectionObserver;
  private _visibleDayElements = new Set<Element>();
  private _isScrollingToDay = false;
  private _pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private _pendingIntervals: ReturnType<typeof setInterval>[] = [];

  visibleDayDate = signal<string | null>(null);

  protected readonly T = T;

  constructor() {
    // Setup intersection observers when day elements change
    effect(() => {
      const elements = this.dayElements();
      if (elements.length > 0) {
        this._setupIntersectionObserver(elements);
        this._setupVisibleDayObserver(elements);
      }
    });

    // Cleanup observers and timers on component destroy
    this._destroyRef.onDestroy(() => {
      this._intersectionObserver?.disconnect();
      this._visibleDayObserver?.disconnect();
      this._pendingTimers.forEach(clearTimeout);
      this._pendingIntervals.forEach(clearInterval);
      this._plannerService.resetScrollState();
    });
  }

  scrollToDay(dayDate: string): void {
    this._isScrollingToDay = true;
    this.visibleDayDate.set(dayDate);

    const host = this._elRef.nativeElement as HTMLElement;
    const el = host.querySelector(
      `[data-day="${CSS.escape(dayDate)}"]`,
    ) as HTMLElement | null;
    if (el) {
      this._scrollToElement(host, el);
    } else {
      this._plannerService.ensureDayLoaded(dayDate);
      this._pollForElement(dayDate);
    }
  }

  private _scrollToElement(host: HTMLElement, el: HTMLElement): void {
    host.scrollTo({ top: el.offsetTop - host.offsetTop, behavior: 'smooth' });
    this._waitForScrollEnd();
  }

  private _waitForScrollEnd(): void {
    const host = this._elRef.nativeElement as HTMLElement;
    let settled = false;

    const onScrollEnd = (): void => {
      if (settled) return;
      settled = true;
      host.removeEventListener('scrollend', onScrollEnd);
      this._isScrollingToDay = false;
    };

    host.addEventListener('scrollend', onScrollEnd, { once: true });

    // Fallback: clear guard after reasonable time
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (settled || attempts > 20) {
        clearInterval(poll);
        if (!settled) {
          settled = true;
          host.removeEventListener('scrollend', onScrollEnd);
          this._isScrollingToDay = false;
        }
      }
    }, 100);
    this._pendingIntervals.push(poll);
  }

  private _pollForElement(dayDate: string, attempt = 0): void {
    if (attempt > 20) {
      this._isScrollingToDay = false;
      return;
    }
    const timer = setTimeout(() => {
      const host = this._elRef.nativeElement as HTMLElement;
      const el = host.querySelector(
        `[data-day="${CSS.escape(dayDate)}"]`,
      ) as HTMLElement | null;
      if (el) {
        this._scrollToElement(host, el);
      } else {
        this._pollForElement(dayDate, attempt + 1);
      }
    }, 100);
    this._pendingTimers.push(timer);
  }

  private _setupVisibleDayObserver(elements: readonly ElementRef[]): void {
    this._visibleDayObserver?.disconnect();
    this._visibleDayElements.clear();

    this._visibleDayObserver = new IntersectionObserver(
      (entries) => {
        if (this._isScrollingToDay) return;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._visibleDayElements.add(entry.target);
          } else {
            this._visibleDayElements.delete(entry.target);
          }
        }

        // Pick topmost visible element by DOM order
        for (const elRef of elements) {
          if (this._visibleDayElements.has(elRef.nativeElement)) {
            const dayAttr = elRef.nativeElement.getAttribute('data-day');
            if (dayAttr && dayAttr !== this.visibleDayDate()) {
              this.visibleDayDate.set(dayAttr);
            }
            break;
          }
        }
      },
      {
        root: this._elRef.nativeElement,
        rootMargin: '0px 0px -80% 0px',
        threshold: 0,
      },
    );

    for (const elRef of elements) {
      this._visibleDayObserver.observe(elRef.nativeElement);
    }
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
