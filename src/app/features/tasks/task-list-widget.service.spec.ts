import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TaskListWidgetService } from './task-list-widget.service';
import { TaskWidgetSettingsService } from '../config/task-widget-settings.service';
import { GlobalThemeService } from '../../core/theme/global-theme.service';
import { selectAllTasks } from './store/task.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { DEFAULT_TASK, Task } from './task.model';
import { TaskWidgetConfig } from '../config/global-config.model';
import { T } from '../../t.const';
import { ElectronAPI } from '../../../../electron/electronAPI';

describe('TaskListWidgetService', () => {
  const task: Task = { ...DEFAULT_TASK, id: 'a', projectId: 'p', title: 'Task' };
  const originalEa = window.ea;
  let settings: ReturnType<typeof signal<Required<TaskWidgetConfig>>>;
  let api: jasmine.SpyObj<ElectronAPI>;
  let store: MockStore;

  beforeEach(() => {
    settings = signal<Required<TaskWidgetConfig>>({
      isEnabled: false,
      isAlwaysShow: false,
      opacity: 95,
      isTaskListEnabled: false,
      isTaskListCollapsed: false,
      taskListFilter: 'all',
    });
    api = jasmine.createSpyObj<ElectronAPI>('ea', ['updateTaskListWidget']);
    window.ea = api;
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectAllTasks, value: [task] },
            { selector: selectAllProjects, value: [] },
            { selector: selectTodayTaskIds, value: [] },
          ],
        }),
        { provide: TaskWidgetSettingsService, useValue: { settings } },
        { provide: GlobalThemeService, useValue: { isDarkTheme: signal(true) } },
        {
          provide: TranslateService,
          useValue: {
            stream: () =>
              of(
                Object.fromEntries(
                  Object.values(T.GCF.TASK_WIDGET.LIST).map((key) => [key, key]),
                ),
              ),
          },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    TestBed.inject(TaskListWidgetService);
    TestBed.tick();
  });
  afterEach(() => {
    window.ea = originalEa;
  });

  it('does not transfer tasks while disabled; enabling sends the current list', () => {
    expect(api.updateTaskListWidget).not.toHaveBeenCalled();
    settings.update((value) => ({ ...value, isTaskListEnabled: true }));
    TestBed.tick();
    expect(api.updateTaskListWidget.calls.mostRecent().args[0].tasks[0].title).toBe(
      'Task',
    );
  });

  it('updates edits and filter changes without resending every tracking tick', () => {
    settings.update((value) => ({ ...value, isTaskListEnabled: true }));
    TestBed.tick();
    store.overrideSelector(selectAllTasks, [{ ...task, timeSpent: 1000 }]);
    store.refreshState();
    TestBed.tick();
    expect(api.updateTaskListWidget).toHaveBeenCalledTimes(1);
    store.overrideSelector(selectAllTasks, [{ ...task, title: 'Renamed' }]);
    store.refreshState();
    TestBed.tick();
    expect(api.updateTaskListWidget.calls.mostRecent().args[0].tasks[0].title).toBe(
      'Renamed',
    );
    settings.update((value) => ({ ...value, taskListFilter: 'today' }));
    TestBed.tick();
    expect(api.updateTaskListWidget.calls.mostRecent().args[0].tasks).toEqual([]);
  });

  it('resends identical content after hiding and reopening the widget', () => {
    settings.update((value) => ({ ...value, isTaskListEnabled: true }));
    TestBed.tick();
    settings.update((value) => ({ ...value, isTaskListEnabled: false }));
    TestBed.tick();
    settings.update((value) => ({ ...value, isTaskListEnabled: true }));
    TestBed.tick();
    expect(api.updateTaskListWidget).toHaveBeenCalledTimes(2);
  });
});
