import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';

import { WorkViewComponent } from './work-view.component';
import { TaskService } from '../tasks/task.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { SnackService } from '../../core/snack/snack.service';
import { GlobalConfigService } from '../config/global-config.service';
import { TaskWithSubTasks } from '../tasks/task.model';
import {
  selectLaterTodayTasksWithSubTasks,
  selectOverdueTasksWithSubTasks,
} from '../tasks/store/task.selectors';
import {
  selectTaskRepeatCfgsByProjectId,
  selectTaskRepeatCfgsByTagId,
} from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TODAY_TAG } from '../tag/tag.const';

/**
 * Tests for the constructor effect() in WorkViewComponent that deselects the
 * currently selected task when it is no longer present in any visible task list
 * (undone / done / later / overdue / backlog). The customizer's list is
 * intentionally NOT consulted: after #7279 it is always a subset of the context's
 * undoneTasks, so checking undoneTasks is sufficient. These tests exercise the
 * real component; the template is overridden to a no-op so we don't have to
 * stand up every child component.
 */

const buildTask = (id: string, subTasks: TaskWithSubTasks[] = []): TaskWithSubTasks =>
  ({ id, subTasks }) as unknown as TaskWithSubTasks;

describe('WorkViewComponent', () => {
  describe('selected task retention effect', () => {
    let selectedTaskId: ReturnType<typeof signal<string | null>>;
    let setSelectedId: jasmine.Spy;
    let customized$: BehaviorSubject<{ list: TaskWithSubTasks[] }>;
    let activeWorkContextId: string;
    let store: MockStore;

    const createComponent = async (
      inputs: {
        undone?: TaskWithSubTasks[];
        done?: TaskWithSubTasks[];
        backlog?: TaskWithSubTasks[];
      } = {},
    ): Promise<WorkViewComponent> => {
      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(WorkViewComponent);
      fixture.componentRef.setInput('undoneTasks', inputs.undone ?? []);
      fixture.componentRef.setInput('doneTasks', inputs.done ?? []);
      fixture.componentRef.setInput('backlogTasks', inputs.backlog ?? []);
      fixture.detectChanges();
      return fixture.componentInstance;
    };

    beforeEach(() => {
      selectedTaskId = signal<string | null>(null);
      setSelectedId = jasmine.createSpy('setSelectedId');
      customized$ = new BehaviorSubject<{ list: TaskWithSubTasks[] }>({ list: [] });
      activeWorkContextId = 'some-project-id';

      TestBed.configureTestingModule({
        imports: [WorkViewComponent, TranslateModule.forRoot()],
        providers: [
          provideNoopAnimations(),
          provideMockStore({ initialState: {} }),
          {
            provide: TaskService,
            useValue: {
              selectedTaskId,
              setSelectedId,
              moveToArchive: () => Promise.resolve(),
            },
          },
          { provide: TakeABreakService, useValue: { resetTimer: () => {} } },
          {
            provide: LayoutService,
            useValue: {
              isXs: signal(false),
              isWorkViewScrolled: { set: () => {} },
              showAddTaskBar: () => {},
            },
          },
          {
            provide: TaskViewCustomizerService,
            useValue: {
              customizeUndoneTasks: () => customized$.asObservable(),
              isCustomized: signal(false),
            },
          },
          {
            provide: WorkContextService,
            useValue: {
              get activeWorkContextId() {
                return activeWorkContextId;
              },
              undoneTasks$: of([]),
              todayRemainingInProject$: of(0),
              estimateRemainingToday$: of(0),
              workingToday$: of(0),
              isTodayList$: of(false),
              activeWorkContextTypeAndId$: of({
                activeType: 'TAG',
                activeId: 'TODAY',
              }),
              isContextChanging$: of(false),
            },
          },
          { provide: ProjectService, useValue: { onMoveToBacklog$: of() } },
          { provide: SnackService, useValue: { open: () => {} } },
          {
            provide: GlobalConfigService,
            useValue: {
              appFeatures: signal({ isFinishDayEnabled: false }),
              cfg: () => ({}),
            },
          },
          { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        ],
      });

      // Stub the template and imports so children (task-list, backlog, etc.)
      // don't need to be instantiated. The constructor effect runs without
      // rendering and this keeps the dependency surface small.
      TestBed.overrideComponent(WorkViewComponent, {
        set: { template: '', imports: [], styles: [''] },
      });

      store = TestBed.inject(MockStore);
      store.overrideSelector(selectOverdueTasksWithSubTasks, []);
      store.overrideSelector(selectLaterTodayTasksWithSubTasks, []);
      store.overrideSelector(selectTaskRepeatCfgsByProjectId, []);
      store.overrideSelector(selectTaskRepeatCfgsByTagId, []);
    });

    it('deselects when the task is absent from every list', async () => {
      await createComponent();
      selectedTaskId.set('ghost');
      TestBed.flushEffects();

      expect(setSelectedId).toHaveBeenCalledOnceWith(null);
    });

    it('keeps the selection when the task is in undoneTasks (existing behaviour)', async () => {
      await createComponent({ undone: [buildTask('undone-1')] });
      selectedTaskId.set('undone-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('keeps the selection when the task is in doneTasks (existing behaviour)', async () => {
      await createComponent({ done: [buildTask('done-1')] });
      selectedTaskId.set('done-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('keeps the selection when the task is in backlogTasks (existing behaviour)', async () => {
      await createComponent({ backlog: [buildTask('backlog-1')] });
      selectedTaskId.set('backlog-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('keeps the selection when on TODAY_TAG and task is in overdueTasks', async () => {
      activeWorkContextId = TODAY_TAG.id;
      store.overrideSelector(selectOverdueTasksWithSubTasks, [buildTask('overdue-1')]);
      store.refreshState();

      await createComponent();
      selectedTaskId.set('overdue-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('deselects when NOT on TODAY_TAG even if task is in overdueTasks', async () => {
      activeWorkContextId = 'some-project-id';
      store.overrideSelector(selectOverdueTasksWithSubTasks, [buildTask('overdue-1')]);
      store.refreshState();

      await createComponent();
      selectedTaskId.set('overdue-1');
      TestBed.flushEffects();

      expect(setSelectedId).toHaveBeenCalledOnceWith(null);
    });

    it('does nothing when selectedTaskId is null', async () => {
      await createComponent();
      selectedTaskId.set(null);
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });
  });
});
