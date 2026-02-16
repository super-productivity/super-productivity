import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlannerPlanViewComponent } from './planner-plan-view.component';
import { PlannerService } from '../planner.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import { selectUndoneOverdue } from '../../tasks/store/task.selectors';

describe('PlannerPlanViewComponent', () => {
  let fixture: ComponentFixture<PlannerPlanViewComponent>;
  let component: PlannerPlanViewComponent;
  let mockPlannerService: jasmine.SpyObj<PlannerService>;

  beforeEach(() => {
    mockPlannerService = jasmine.createSpyObj('PlannerService', [
      'loadMoreDays',
      'resetScrollState',
      'ensureDayLoaded',
    ]);
    mockPlannerService.days$ = of([]);
    mockPlannerService.isLoadingMore$ = new BehaviorSubject<boolean>(false);

    TestBed.configureTestingModule({
      imports: [PlannerPlanViewComponent],
      providers: [
        { provide: PlannerService, useValue: mockPlannerService },
        provideMockStore({
          selectors: [{ selector: selectUndoneOverdue, value: [] }],
        }),
      ],
    });

    fixture = TestBed.createComponent(PlannerPlanViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
  });

  it('should call resetScrollState on destroy', () => {
    fixture.destroy();
    expect(mockPlannerService.resetScrollState).toHaveBeenCalledTimes(1);
  });

  describe('timer cleanup on destroy', () => {
    it('should clear pending timers on destroy', () => {
      const clearTimeoutSpy = spyOn(window, 'clearTimeout').and.callThrough();

      // Trigger scrollToDay to a day that does not exist in the DOM, which starts polling
      // and pushes timer IDs into _pendingTimers
      component.scrollToDay('2026-03-01');

      // Destroy the component to trigger cleanup
      fixture.destroy();

      // clearTimeout should have been called for each pending timer
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear pending intervals on destroy', () => {
      const clearIntervalSpy = spyOn(window, 'clearInterval').and.callThrough();

      // Create a mock element so scrollToDay finds it and calls _scrollToElement,
      // which sets up _waitForScrollEnd with an interval
      const host = fixture.nativeElement as HTMLElement;
      const fakeDay = document.createElement('div');
      fakeDay.setAttribute('data-day', '2026-02-16');
      host.appendChild(fakeDay);

      component.scrollToDay('2026-02-16');

      fixture.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('scrollToDay', () => {
    it('should set visibleDayDate signal and _isScrollingToDay flag', () => {
      // Initially visibleDayDate is null
      expect(component.visibleDayDate()).toBeNull();

      component.scrollToDay('2026-03-15');

      expect(component.visibleDayDate()).toBe('2026-03-15');
    });

    it('should use CSS.escape in querySelector', () => {
      const cssEscapeSpy = spyOn(CSS, 'escape').and.callThrough();

      component.scrollToDay('2026-03-15');

      expect(cssEscapeSpy).toHaveBeenCalledWith('2026-03-15');
    });

    it('should call ensureDayLoaded when element not found', () => {
      // No element with data-day="2026-05-01" exists in the DOM
      component.scrollToDay('2026-05-01');

      expect(mockPlannerService.ensureDayLoaded).toHaveBeenCalledWith('2026-05-01');
    });

    it('should not call ensureDayLoaded when element is found', () => {
      const host = fixture.nativeElement as HTMLElement;
      const fakeDay = document.createElement('div');
      fakeDay.setAttribute('data-day', '2026-02-20');
      host.appendChild(fakeDay);

      component.scrollToDay('2026-02-20');

      expect(mockPlannerService.ensureDayLoaded).not.toHaveBeenCalled();
    });
  });
});
