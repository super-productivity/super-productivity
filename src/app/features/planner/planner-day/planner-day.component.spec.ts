import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { PlannerDayComponent } from './planner-day.component';
import { PlannerDay } from '../planner.model';
import { TaskService } from '../../tasks/task.service';
import { DateService } from '../../../core/date/date.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CdkDragDrop, CdkDragStart, DragRef } from '@angular/cdk/drag-drop';
import { of } from 'rxjs';
import { TaskCopy, TaskWithSubTasks } from '../../tasks/task.model';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

describe('PlannerDayComponent', () => {
  const createComponent = (
    currentLocale: string,
    isoTextLocale: string | null,
  ): PlannerDayComponent => {
    TestBed.configureTestingModule({
      imports: [PlannerDayComponent],
      providers: [
        provideMockStore(),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: TaskService, useValue: {} },
        { provide: DateService, useValue: {} },
        { provide: LayoutService, useValue: { isXs: signal(false) } },
        {
          provide: DateTimeFormatService,
          useValue: {
            currentLocale: signal(currentLocale),
            isoTextLocale: signal(isoTextLocale),
          },
        },
      ],
    });
    TestBed.overrideComponent(PlannerDayComponent, { set: { template: '' } });
    const component = TestBed.createComponent(PlannerDayComponent).componentInstance;
    component.day = { dayDate: '2026-05-11' } as PlannerDay;
    return component;
  };

  const getDayLabel = (component: PlannerDayComponent): string =>
    (
      component as unknown as {
        dayLabel: () => string;
      }
    ).dayLabel();

  const createRenderedComponent = (): ComponentFixture<PlannerDayComponent> => {
    TestBed.configureTestingModule({
      imports: [PlannerDayComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: TaskService, useValue: {} },
        { provide: DateService, useValue: {} },
        { provide: LayoutService, useValue: { isXs: signal(false) } },
        {
          provide: DateTimeFormatService,
          useValue: {
            currentLocale: signal('en'),
            isoTextLocale: signal('en'),
          },
        },
      ],
    });
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: {
        PLANNER: {
          DAY_LOAD: 'Planned: {{planned}} / Available: {{available}}',
          NO_TASKS: 'No tasks',
        },
      },
      G: { ADD: 'Add' },
    });
    translateService.use('en');

    const fixture = TestBed.createComponent(PlannerDayComponent);
    fixture.componentInstance.day = {
      dayDate: '2026-05-11',
      timeEstimate: 0,
      timeLimit: 0,
      itemsTotal: 0,
      tasks: [],
      deadlineTasks: [],
      noStartTimeRepeatProjections: [],
      allDayEvents: [],
      scheduledIItems: [],
      availableHours: 7 * 60 * 60 * 1000,
      progressPercentage: 0,
    };
    fixture.detectChanges();
    return fixture;
  };

  beforeAll(() => registerLocaleData(localeDe, 'de-DE'));

  it('uses the UI language for the weekday label with ISO formatting enabled', () => {
    const component = createComponent('sv', 'de');

    expect(getDayLabel(component)).toBe('Mo');
  });

  it('preserves Angular weekday formatting for non-ISO locales', () => {
    const component = createComponent('de-DE', null);

    expect(getDayLabel(component)).toBe('Mo.');
  });

  it('labels planned and available time and displays an explicit zero', () => {
    const fixture = createRenderedComponent();
    const dayLoad = fixture.nativeElement.querySelector('.day-load');

    expect(dayLoad?.textContent.trim()).toBe('Planned: 0m / Available: 7h');
  });
});

describe('PlannerDayComponent side nav drag (#11210)', () => {
  const task = { id: 't1' } as TaskCopy;
  const taskWithSubTasks = { id: 't1', subTasks: [] } as unknown as TaskWithSubTasks;
  const dragRef = {} as DragRef;
  let component: PlannerDayComponent;
  let store: MockStore;
  let externalDragService: ScheduleExternalDragService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlannerDayComponent],
      providers: [
        provideMockStore(),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: TaskService,
          useValue: { getByIdWithSubTaskData$: () => of(taskWithSubTasks) },
        },
        { provide: DateService, useValue: {} },
        { provide: LayoutService, useValue: { isXs: signal(false) } },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: signal('en-US'), isoTextLocale: signal(null) },
        },
      ],
    });
    TestBed.overrideComponent(PlannerDayComponent, { set: { template: '' } });
    component = TestBed.createComponent(PlannerDayComponent).componentInstance;
    component.day = { dayDate: '2026-05-11', isToday: true } as PlannerDay;
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    externalDragService = TestBed.inject(ScheduleExternalDragService);
  });

  const sameListDrop = (): CdkDragDrop<string, string, TaskCopy> => {
    const container = { data: '2026-05-11' };
    return {
      container,
      previousContainer: container,
      item: { data: task },
      currentIndex: 0,
      previousIndex: 0,
    } as unknown as CdkDragDrop<string, string, TaskCopy>;
  };

  it('registers the dragged task with its subtasks so the side nav can handle it', () => {
    component.onDragStarted(task, {
      source: { _dragRef: dragRef },
    } as unknown as CdkDragStart);

    expect(externalDragService.activeTask()).toBe(taskWithSubTasks);
    expect(externalDragService.activeDragRef()).toBe(dragRef);

    component.onDragEnded();
    expect(externalDragService.activeTask()).toBeNull();
  });

  it('skips the in-list reorder when the side nav already handled the drop', () => {
    externalDragService.setCancelNextDrop(true);

    component.drop('TODO', [task], sameListDrop());

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(externalDragService.isCancelNextDrop()).toBe(false);
  });

  it('reorders within today when no external drop happened', () => {
    component.drop('TODO', [task], sameListDrop());

    expect(store.dispatch).toHaveBeenCalledWith(
      TaskSharedActions.moveTaskInTodayTagList({ toTaskId: 't1', fromTaskId: 't1' }),
    );
  });
});
