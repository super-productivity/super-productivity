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
import { TaskMultiDragService } from '../../tasks/task-multi-drag.service';
import { PlannerGroupDropService } from '../planner-group-drop.service';

const createMultiDragStub = (): Partial<TaskMultiDragService> => ({
  start: jasmine.createSpy('start'),
  finish: jasmine.createSpy('finish'),
  ids: signal<readonly string[]>([]),
  plannerPreviewTasks: signal(
    [],
  ) as unknown as TaskMultiDragService['plannerPreviewTasks'],
});
const createGroupDropStub = (
  isGroupDrag = false,
): jasmine.SpyObj<PlannerGroupDropService> => {
  const stub = jasmine.createSpyObj<PlannerGroupDropService>('PlannerGroupDropService', [
    'isGroupDrag',
    'drop',
  ]);
  stub.isGroupDrag.and.returnValue(isGroupDrag);
  return stub;
};

describe('PlannerDayComponent', () => {
  const createComponent = (
    currentLocale: string,
    isoTextLocale: string | null,
  ): PlannerDayComponent => {
    TestBed.configureTestingModule({
      imports: [PlannerDayComponent],
      providers: [
        provideMockStore(),
        { provide: TaskMultiDragService, useValue: createMultiDragStub() },
        { provide: PlannerGroupDropService, useValue: createGroupDropStub() },
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
        { provide: TaskMultiDragService, useValue: createMultiDragStub() },
        { provide: PlannerGroupDropService, useValue: createGroupDropStub() },
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
  let groupDrop: jasmine.SpyObj<PlannerGroupDropService>;

  beforeEach(() => {
    groupDrop = createGroupDropStub();
    TestBed.configureTestingModule({
      imports: [PlannerDayComponent],
      providers: [
        provideMockStore(),
        { provide: TaskMultiDragService, useValue: createMultiDragStub() },
        { provide: PlannerGroupDropService, useValue: groupDrop },
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

  describe('with a selected group', () => {
    const otherList = { data: '2026-05-10' };
    const groupDropEvent = (
      currentIndex: number,
      isSameList: boolean,
      previousIndex = 0,
      isPointerOverContainer = true,
    ): CdkDragDrop<string, string, TaskCopy> => {
      const container = {
        data: '2026-05-11',
        element: {
          nativeElement: {
            getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
          },
        },
      };
      return {
        container,
        previousContainer: isSameList ? container : otherList,
        item: { data: task },
        currentIndex,
        previousIndex,
        isPointerOverContainer,
        dropPoint: { x: 500, y: 500 },
      } as unknown as CdkDragDrop<string, string, TaskCopy>;
    };

    beforeEach(() => groupDrop.isGroupDrag.and.returnValue(true));

    it('registers no single task, so only the side nav group path moves it', () => {
      component.onDragStarted(task, {
        source: { _dragRef: dragRef },
      } as unknown as CdkDragStart);

      expect(TestBed.inject(TaskMultiDragService).start).toHaveBeenCalledWith(
        task,
        'PLANNER',
      );
      expect(externalDragService.activeTask()).toBeNull();
      expect(externalDragService.activeDragRef()).toBe(dragRef);
      expect(component.acceptSingleCard()).toBeFalse();
    });

    it('hands a drop from another day to the group drop at the leader slot', () => {
      const items = [{ id: 'x' }, { id: 'y' }] as TaskCopy[];
      component.drop('TODO', items, groupDropEvent(1, false));

      expect(groupDrop.drop).toHaveBeenCalledWith(
        '2026-05-11',
        't1',
        ['x', 't1', 'y'],
        ['x', 'y'],
      );
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('hands a reorder within the day to the group drop', () => {
      const items = [{ id: 'x' }, task, { id: 'y' }] as TaskCopy[];
      component.drop('TODO', items, groupDropEvent(2, true, 1));

      expect(groupDrop.drop).toHaveBeenCalledWith(
        '2026-05-11',
        't1',
        ['x', 'y', 't1'],
        ['x', 't1', 'y'],
      );
    });

    it('leaves the group in place when released outside every list', () => {
      const items = [{ id: 'x' }, task, { id: 'y' }] as TaskCopy[];
      component.drop('TODO', items, groupDropEvent(1, true, 1, false));

      expect(groupDrop.drop).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('never reschedules a group through the timed list', () => {
      component.drop('SCHEDULED', [], groupDropEvent(0, false));

      expect(groupDrop.drop).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });
});
