import { Component, Input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { AllTasksPageComponent } from './all-tasks-page.component';
import { WorkViewComponent } from '../work-view/work-view.component';
import { selectAllTasksWithSubTasksInActiveProjects } from '../tasks/store/task.selectors';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import {
  DEFAULT_OPTIONS,
  FILTER_OPTION_TYPE,
  FilterOption,
} from '../task-view-customizer/types';
import { TaskWithSubTasks } from '../tasks/task.model';

/** Captures the inputs the page hands to the reused work view. */
@Component({
  selector: 'work-view',
  template: '',
  standalone: true,
})
class StubWorkViewComponent {
  @Input() undoneTasks: TaskWithSubTasks[] = [];
  @Input() doneTasks: TaskWithSubTasks[] = [];
  @Input() backlogTasks: TaskWithSubTasks[] = [];
  @Input() isDisableTodayPanels = false;
}

const task = (
  id: string,
  projectId: string,
  extra: Partial<TaskWithSubTasks> = {},
): TaskWithSubTasks =>
  ({
    id,
    projectId,
    title: id,
    isDone: false,
    subTasks: [],
    ...extra,
  }) as unknown as TaskWithSubTasks;

describe('AllTasksPageComponent', () => {
  let fixture: ComponentFixture<AllTasksPageComponent>;
  let store: MockStore;
  let selectedFilter: WritableSignal<FilterOption>;
  let setContextKeyOverride: jasmine.Spy;

  const undoneA = task('undone-a', 'PROJ_A');
  const doneA = task('done-a', 'PROJ_A', { isDone: true, doneOn: 100 });
  const doneB = task('done-b', 'PROJ_B', { isDone: true, doneOn: 200 });

  beforeEach(() => {
    selectedFilter = signal<FilterOption>(DEFAULT_OPTIONS.filter);
    setContextKeyOverride = jasmine.createSpy('setContextKeyOverride');

    TestBed.configureTestingModule({
      imports: [AllTasksPageComponent],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: TaskViewCustomizerService,
          useValue: {
            selectedFilter,
            setContextKeyOverride,
            customizeUndoneTasks: (tasks$: unknown) => tasks$,
          },
        },
      ],
    });
    TestBed.overrideComponent(AllTasksPageComponent, {
      remove: { imports: [WorkViewComponent] },
      add: { imports: [StubWorkViewComponent] },
    });

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectAllTasksWithSubTasksInActiveProjects, [
      undoneA,
      doneA,
      doneB,
    ]);

    fixture = TestBed.createComponent(AllTasksPageComponent);
    fixture.detectChanges();
  });

  const workView = (): StubWorkViewComponent =>
    fixture.debugElement.children[0].componentInstance as StubWorkViewComponent;

  const selectProjects = (projectIds: string[]): void => {
    selectedFilter.set({
      type: FILTER_OPTION_TYPE.project,
      preset: null,
      label: 'Projects',
      projectIds,
    });
    fixture.detectChanges();
  };

  it('keeps undone and done tasks separate, done newest first', () => {
    expect(workView().undoneTasks.map((t) => t.id)).toEqual(['undone-a']);
    expect(workView().doneTasks.map((t) => t.id)).toEqual(['done-b', 'done-a']);
  });

  it('narrows the done list by the selected projects too', () => {
    // Regression: the project filter used to narrow only the undone list, so
    // the page could show "one project selected" while Done still listed every
    // project's finished work.
    expect(workView().doneTasks.length).toBe(2);

    selectProjects(['PROJ_A']);

    expect(workView().doneTasks.map((t) => t.id)).toEqual(['done-a']);
    // The undone list keeps coming from the selector (it is customized inside
    // the reused view, not here).
    expect(workView().undoneTasks.map((t) => t.id)).toEqual(['undone-a']);
  });

  it('shows every project again once the selection is cleared', () => {
    selectProjects(['PROJ_A']);
    expect(workView().doneTasks.length).toBe(1);

    selectedFilter.set(DEFAULT_OPTIONS.filter);
    fixture.detectChanges();
    expect(workView().doneTasks.length).toBe(2);
  });

  it('tells the reused view to hide the Today-only panels', () => {
    expect(workView().isDisableTodayPanels).toBe(true);
  });

  it('claims the customizer context on init and releases it on destroy', () => {
    expect(setContextKeyOverride).toHaveBeenCalledWith('ALL_TASKS');

    fixture.destroy();
    expect(setContextKeyOverride).toHaveBeenCalledWith(null);
  });
});
