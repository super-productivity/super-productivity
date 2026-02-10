import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlannerPlanViewComponent } from './planner-plan-view.component';
import { PlannerService } from '../planner.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';
import { selectUndoneOverdue } from '../../tasks/store/task.selectors';

describe('PlannerPlanViewComponent', () => {
  let fixture: ComponentFixture<PlannerPlanViewComponent>;
  let mockPlannerService: jasmine.SpyObj<PlannerService>;

  beforeEach(() => {
    mockPlannerService = jasmine.createSpyObj('PlannerService', [
      'loadMoreDays',
      'resetScrollState',
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
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
  });

  it('should call resetScrollState on destroy', () => {
    fixture.destroy();
    expect(mockPlannerService.resetScrollState).toHaveBeenCalledTimes(1);
  });
});
