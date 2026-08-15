import {
  ComponentFixture,
  discardPeriodicTasks,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
import { ElementRef, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';

import { WorkViewComponent } from './work-view.component';
import { TaskService } from '../tasks/task.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskViewCustomizerService } from '../task-view-customizer/task-view-customizer.service';
import { WorkContextService } from '../work-context/work-context.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { ProjectService } from '../project/project.service';
import { SectionService } from '../section/section.service';
import { Section } from '../section/section.model';
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
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../root-store/app-state/app-state.selectors';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { TODAY_TAG } from '../tag/tag.const';
import { LS } from '../../core/persistence/storage-keys.const';

/** Shape the customizer emits, narrowed to what these specs vary. */
type CustomizedStub = {
  list: TaskWithSubTasks[];
  grouped?: Record<string, TaskWithSubTasks[]>;
};

/**
 * Tests for the constructor effect() in WorkViewComponent that deselects the
 * currently selected task when it is no longer present in any visible task list
 * (undone / done / later / overdue / backlog). When the task view customizer
 * filters the undone list, the selected task must also be present in the
 * customized visible list. These tests exercise the real component; the
 * template is overridden to a no-op so we don't have to stand up every child
 * component.
 */

const buildTask = (id: string, subTasks: TaskWithSubTasks[] = []): TaskWithSubTasks =>
  ({ id, subTasks }) as unknown as TaskWithSubTasks;

type ServiceStub = Record<string, unknown>;

/**
 * Mutable so a spec can switch work context after the TestBed is configured —
 * the component reads `activeWorkContextId` as a plain property, and a spread
 * would freeze the value at configuration time.
 */
const activeContext = { id: 'ctx' };

/**
 * One TestBed setup for the whole file: each block overrides only the stub
 * members it exercises, and everything else stays the minimal surface the
 * component touches while constructing.
 */
const configureWorkViewTestBed = (
  overrides: {
    taskService?: ServiceStub;
    customizerService?: ServiceStub;
    sectionService?: ServiceStub;
    queryParams$?: Observable<Record<string, string>>;
    /** Drives `isOnTodayList()`, which gates the Overdue/Later Today panels. */
    isTodayList?: boolean;
    /** Plugin id embedded in the work-view body; replaces the whole task list. */
    embedPluginId?: string | null;
  } = {},
): void => {
  const workContextService = {
    get activeWorkContextId(): string {
      return activeContext.id;
    },
    undoneTasks$: of([]),
    todayRemainingInProject$: of(0),
    estimateRemainingToday$: of(0),
    workingToday$: of(0),
    breakTimeToday$: of(0),
    isTodayList$: of(overrides.isTodayList ?? false),
    activeWorkContextId$: of('ctx'),
    activeWorkContextTypeAndId$: of({ activeType: 'PROJECT', activeId: 'ctx' }),
    activeWorkContext$: of({ id: 'ctx', type: 'PROJECT' }),
    isActiveWorkContextProject$: of(true),
    isContextChanging$: of(false),
  };

  // Reset the shared mutable context: a block that switched it to TODAY would
  // otherwise decide the starting context of every later block, since Jasmine
  // randomizes spec order.
  activeContext.id = 'ctx';

  TestBed.configureTestingModule({
    imports: [WorkViewComponent, TranslateModule.forRoot()],
    providers: [
      provideNoopAnimations(),
      provideMockStore({ initialState: {} }),
      {
        provide: TaskService,
        useValue: {
          selectedTaskId: signal<string | null>(null),
          setSelectedId: () => {},
          moveToArchive: () => Promise.resolve(),
          ...overrides.taskService,
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
          customizeUndoneTasks: () => of({ list: [] as TaskWithSubTasks[] }),
          isCustomized: signal(false),
          ...overrides.customizerService,
        },
      },
      { provide: WorkContextService, useValue: workContextService },
      {
        provide: PluginBridgeService,
        useValue: {
          workContextEmbedPluginId: signal<string | null>(
            overrides.embedPluginId ?? null,
          ),
        },
      },
      { provide: ProjectService, useValue: { onMoveToBacklog$: of() } },
      {
        provide: SectionService,
        useValue: {
          getSectionsByContextId$: () => of([] as readonly Section[]),
          ...overrides.sectionService,
        },
      },
      { provide: SnackService, useValue: { open: () => {} } },
      {
        provide: CalendarIntegrationService,
        useValue: { calendarEvents$: of([]) },
      },
      {
        provide: GlobalConfigService,
        useValue: {
          appFeatures: signal({ isFinishDayEnabled: false }),
          cfg: () => ({}),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { queryParams: overrides.queryParams$ ?? of({}) },
      },
    ],
  });

  // Stub the template and imports so children (task-list, backlog, …) don't have
  // to be instantiated; everything under test runs without rendering.
  TestBed.overrideComponent(WorkViewComponent, {
    set: { template: '', imports: [], styles: [''] },
  });
};

/** Selector defaults every block needs. */
const overrideDefaultSelectors = (store: MockStore): void => {
  store.overrideSelector(selectOverdueTasksWithSubTasks, []);
  store.overrideSelector(selectLaterTodayTasksWithSubTasks, []);
  store.overrideSelector(selectTaskRepeatCfgsByProjectId, []);
  store.overrideSelector(selectTaskRepeatCfgsByTagId, []);
  store.overrideSelector(selectTodayStr, '2026-06-23');
  store.overrideSelector(selectStartOfNextDayDiffMs, 0);
};

describe('WorkViewComponent', () => {
  let store: MockStore;

  // overrideSelector() calls setResult() on the GLOBAL selector singletons, and
  // NgRx MockStore does not auto-clear them between specs. Without this, the
  // frozen today/offset values (selectTodayStr, selectStartOfNextDayDiffMs) leak
  // into later specs (e.g. planner.selectors, task.selectors) under Jasmine's
  // randomized spec order and make their "today" assertions fail intermittently.
  afterEach(() => {
    store?.resetSelectors();
  });

  describe('selected task retention effect', () => {
    let selectedTaskId: ReturnType<typeof signal<string | null>>;
    let setSelectedId: jasmine.Spy;
    let customized$: BehaviorSubject<{ list: TaskWithSubTasks[] }>;
    // Indirection so a single test can swap in a source that hasn't emitted yet
    // (a plain Subject) to exercise the sentinel/readiness guard.
    let customizeSource: () => Observable<{ list: TaskWithSubTasks[] }>;
    let isCustomized: ReturnType<typeof signal<boolean>>;

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
      customizeSource = () => customized$.asObservable();
      isCustomized = signal(false);
      activeContext.id = 'some-project-id';

      configureWorkViewTestBed({
        taskService: { selectedTaskId, setSelectedId },
        customizerService: {
          customizeUndoneTasks: () => customizeSource(),
          isCustomized,
        },
      });

      store = TestBed.inject(MockStore);
      overrideDefaultSelectors(store);
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

    it('deselects when the customizer filters the selected undone task out', async () => {
      isCustomized.set(true);
      customized$.next({ list: [buildTask('visible-1')] });

      await createComponent({ undone: [buildTask('hidden-1'), buildTask('visible-1')] });
      selectedTaskId.set('hidden-1');
      TestBed.flushEffects();

      expect(setSelectedId).toHaveBeenCalledOnceWith(null);
    });

    it('keeps the selection when the selected undone task remains in the customized list', async () => {
      isCustomized.set(true);
      customized$.next({ list: [buildTask('visible-1')] });

      await createComponent({ undone: [buildTask('hidden-1'), buildTask('visible-1')] });
      selectedTaskId.set('visible-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('does not deselect while the customized list has not emitted yet, then deselects once it does', async () => {
      // isCustomized() flips synchronously, but customizeUndoneTasks defers the
      // customized branch by one animation frame, so the list can lag. Use a
      // source that has not emitted: the signal stays at the sentinel initial
      // value and the deselect must be skipped (returning null) rather than
      // firing against a not-yet-ready list.
      const pendingCustomized$ = new Subject<{ list: TaskWithSubTasks[] }>();
      customizeSource = () => pendingCustomized$;
      isCustomized.set(true);

      await createComponent({ undone: [buildTask('hidden-1')] });
      selectedTaskId.set('hidden-1');
      TestBed.flushEffects();

      // List not ready yet -> skip, do not close the panel on the selected task.
      expect(setSelectedId).not.toHaveBeenCalled();

      // The filtered list lands without the selected task -> now it deselects.
      pendingCustomized$.next({ list: [buildTask('other-1')] });
      TestBed.flushEffects();

      expect(setSelectedId).toHaveBeenCalledOnceWith(null);
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
      activeContext.id = TODAY_TAG.id;
      store.overrideSelector(selectOverdueTasksWithSubTasks, [buildTask('overdue-1')]);
      store.refreshState();

      await createComponent();
      selectedTaskId.set('overdue-1');
      TestBed.flushEffects();

      expect(setSelectedId).not.toHaveBeenCalled();
    });

    it('deselects when NOT on TODAY_TAG even if task is in overdueTasks', async () => {
      activeContext.id = 'some-project-id';
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

  describe('undoneTasksBySection', () => {
    const buildSection = (id: string, taskIds: string[]): Section =>
      ({
        id,
        title: id,
        contextId: 'ctx',
        contextType: 'PROJECT',
        taskIds,
      }) as unknown as Section;

    const setup = async (
      sections: Section[],
      undone: TaskWithSubTasks[],
    ): Promise<WorkViewComponent> => {
      configureWorkViewTestBed({
        sectionService: {
          getSectionsByContextId$: () => of(sections as readonly Section[]),
        },
      });
      store = TestBed.inject(MockStore);
      overrideDefaultSelectors(store);

      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(WorkViewComponent);
      fixture.componentRef.setInput('undoneTasks', undone);
      fixture.componentRef.setInput('doneTasks', []);
      fixture.componentRef.setInput('backlogTasks', []);
      fixture.detectChanges();
      return fixture.componentInstance;
    };

    it('orders tasks within a section by section.taskIds, not undoneTasks order', async () => {
      // undoneTasks order is [a, b, c] but section says [c, a]
      const cmp = await setup(
        [buildSection('s1', ['c', 'a'])],
        [buildTask('a'), buildTask('b'), buildTask('c')],
      );

      const result = cmp.undoneTasksBySection();
      expect(result.dict['s1'].map((t) => t.id)).toEqual(['c', 'a']);
      expect(result.noSection.map((t) => t.id)).toEqual(['b']);
    });

    it('filters out stale ids in section.taskIds (deleted/archived tasks)', async () => {
      const cmp = await setup(
        [buildSection('s1', ['ghost', 'a', 'also-gone'])],
        [buildTask('a'), buildTask('b')],
      );

      const result = cmp.undoneTasksBySection();
      expect(result.dict['s1'].map((t) => t.id)).toEqual(['a']);
      expect(result.noSection.map((t) => t.id)).toEqual(['b']);
    });

    it('falls through to noSection when a task is in no section', async () => {
      const cmp = await setup(
        [buildSection('s1', ['a'])],
        [buildTask('a'), buildTask('b'), buildTask('c')],
      );

      const result = cmp.undoneTasksBySection();
      expect(result.dict['s1'].map((t) => t.id)).toEqual(['a']);
      // noSection preserves undoneTasks order
      expect(result.noSection.map((t) => t.id)).toEqual(['b', 'c']);
    });

    it('returns empty array for empty sections and renders all tasks in noSection', async () => {
      const cmp = await setup(
        [buildSection('s1', []), buildSection('s2', [])],
        [buildTask('a'), buildTask('b')],
      );

      const result = cmp.undoneTasksBySection();
      expect(result.dict['s1']).toEqual([]);
      expect(result.dict['s2']).toEqual([]);
      expect(result.noSection.map((t) => t.id)).toEqual(['a', 'b']);
    });

    it('puts all tasks in noSection when there are no sections', async () => {
      const cmp = await setup([], [buildTask('a'), buildTask('b')]);

      const result = cmp.undoneTasksBySection();
      expect(result.dict).toEqual({});
      expect(result.noSection.map((t) => t.id)).toEqual(['a', 'b']);
    });
  });

  /**
   * A `collapsible` renders its content behind `@if (isExpanded)`, so a task in a
   * collapsed group or section has no DOM node at all and the `focusItem` retry
   * loop can only expire silently. Driven through the real entry point (the
   * `focusItem` query param) so the wiring is covered, not just the helper. (#8780)
   */
  describe('focusItem reveals collapsed containers (#8780)', () => {
    const buildCollapsibleSection = (id: string, taskIds: string[]): Section =>
      ({
        id,
        title: id,
        contextId: 'ctx',
        contextType: 'PROJECT',
        taskIds,
        isExpanded: false,
      }) as unknown as Section;

    // The focus retry loop keeps rescheduling for ~5s; without an explicit
    // destroy those timers outlive the spec and run against a reset MockStore.
    let fixture: ComponentFixture<WorkViewComponent> | undefined;
    afterEach(() => {
      fixture?.destroy();
      fixture = undefined;
      // The panel signals persist to localStorage, and the component seeds them
      // from it at construction — a spec that left one collapsed would decide
      // the starting state of every later one under randomized spec order.
      localStorage.removeItem(LS.DONE_TASKS_HIDDEN);
      localStorage.removeItem(LS.OVERDUE_TASKS_HIDDEN);
      localStorage.removeItem(LS.LATER_TODAY_TASKS_HIDDEN);
    });

    const setup = (opts: {
      focusItem?: string;
      queryParams$?: Observable<Record<string, string>>;
      doneTasks?: TaskWithSubTasks[];
      overdueTasks?: TaskWithSubTasks[];
      laterTodayTasks?: TaskWithSubTasks[];
      undone?: TaskWithSubTasks[];
      grouped?: Record<string, TaskWithSubTasks[]>;
      /** Source for the customized list, for specs where it arrives late. */
      customized$?: Observable<CustomizedStub>;
      collapsedGroupIds?: string[];
      sections?: Section[];
      /** Source for the sections, for specs where they arrive late. */
      sections$?: Observable<readonly Section[]>;
      /** Defaults to "grouping is the only customization", as in the app. */
      isCustomized?: boolean;
      isTodayList?: boolean;
      embedPluginId?: string | null;
    }): {
      cmp: WorkViewComponent;
      toggleGroupExpansion: jasmine.Spy;
      updateSection: jasmine.Spy;
    } => {
      const toggleGroupExpansion = jasmine.createSpy('toggleGroupExpansion');
      const updateSection = jasmine.createSpy('updateSection');
      const undone = opts.undone ?? [];

      configureWorkViewTestBed({
        customizerService: {
          customizeUndoneTasks: () =>
            opts.customized$ ?? of({ list: undone, grouped: opts.grouped }),
          isCustomized: signal(opts.isCustomized ?? !!(opts.grouped || opts.customized$)),
          collapsedGroupIds: signal(opts.collapsedGroupIds ?? []),
          toggleGroupExpansion,
          getOrderedGroupKeys: (grouped: Record<string, TaskWithSubTasks[]>) =>
            Object.keys(grouped),
        },
        sectionService: {
          getSectionsByContextId$: () =>
            opts.sections$ ?? of((opts.sections ?? []) as readonly Section[]),
          updateSection,
        },
        queryParams$:
          opts.queryParams$ ??
          (opts.focusItem ? of({ focusItem: opts.focusItem }) : undefined),
        isTodayList: opts.isTodayList,
        embedPluginId: opts.embedPluginId,
      });
      store = TestBed.inject(MockStore);
      overrideDefaultSelectors(store);
      if (opts.overdueTasks) {
        store.overrideSelector(selectOverdueTasksWithSubTasks, opts.overdueTasks);
      }
      if (opts.laterTodayTasks) {
        store.overrideSelector(selectLaterTodayTasksWithSubTasks, opts.laterTodayTasks);
      }

      fixture = TestBed.createComponent(WorkViewComponent);
      fixture.componentRef.setInput('undoneTasks', undone);
      fixture.componentRef.setInput('doneTasks', opts.doneTasks ?? []);
      fixture.componentRef.setInput('backlogTasks', []);
      fixture.detectChanges();
      return {
        cmp: fixture.componentInstance,
        toggleGroupExpansion,
        updateSection,
      };
    };

    /** Re-runs a focus attempt the way a freshly rendered split pane does. */
    const retriggerFocusAttempt = (cmp: WorkViewComponent): void => {
      cmp.splitTopElRef = new ElementRef(document.createElement('div'));
    };

    it('expands the collapsed group holding the focused task', () => {
      const { toggleGroupExpansion } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted'), buildTask('other')],
        grouped: { groupA: [buildTask('other')], groupB: [buildTask('wanted')] },
        collapsedGroupIds: ['groupA', 'groupB'],
      });

      expect(toggleGroupExpansion).toHaveBeenCalledOnceWith('groupB');
    });

    it('expands the collapsed group when the focused task is a subtask inside it', () => {
      // The reporter's case combined with grouping: search results point at
      // subtasks, and the group lists only their parents.
      const parent = buildTask('parent', [buildTask('wanted-sub')]);
      const { toggleGroupExpansion } = setup({
        focusItem: 'wanted-sub',
        undone: [parent],
        grouped: { groupA: [parent] },
        collapsedGroupIds: ['groupA'],
      });

      expect(toggleGroupExpansion).toHaveBeenCalledOnceWith('groupA');
    });

    it('ignores a stale collapsed id that resolves off Object.prototype', () => {
      // Group keys are user-authored project/tag titles and the collapsed ids are
      // rehydrated from localStorage, so `constructor` is a reachable value.
      // Indexing `grouped` by it would yield a function rather than a task list.
      const { toggleGroupExpansion } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: ['constructor', 'toString'],
      });

      expect(toggleGroupExpansion).not.toHaveBeenCalled();
    });

    it('does nothing when the target is in no group', () => {
      const { toggleGroupExpansion } = setup({
        focusItem: 'nope',
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: ['groupA'],
      });

      expect(toggleGroupExpansion).not.toHaveBeenCalled();
    });

    it('leaves already expanded groups alone', () => {
      const { toggleGroupExpansion } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: [],
      });

      expect(toggleGroupExpansion).not.toHaveBeenCalled();
    });

    it('expands the collapsed section holding the focused task', () => {
      const { updateSection } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted'), buildTask('other')],
        sections: [
          buildCollapsibleSection('s1', ['other']),
          buildCollapsibleSection('s2', ['wanted']),
        ],
      });

      expect(updateSection).toHaveBeenCalledOnceWith('s2', { isExpanded: true });
    });

    it('never expands a section while the customizer is on, since none is rendered', () => {
      // Sort-only/filter-only customization: `grouped` is undefined but the
      // template renders the flat list, so no section collapsible exists.
      // Expanding one would push a synced op to every device for nothing.
      const { updateSection } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        isCustomized: true,
        sections: [buildCollapsibleSection('s1', ['wanted'])],
      });

      expect(updateSection).not.toHaveBeenCalled();
    });

    it('expands the collapsed Done panel for a done task', () => {
      // The Done/Overdue/Later panels are siblings of the undone list, so they
      // are checked whatever it renders — and a done task hidden behind one
      // reproduces the reported symptom exactly. Search can return done tasks
      // via its "include completed" option.
      const { cmp } = setup({
        focusItem: 'done-1',
        doneTasks: [buildTask('done-1')],
      });
      cmp.isDoneHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isDoneHidden()).toBe(false);
    });

    it('expands the collapsed Overdue panel for an overdue task', () => {
      const { cmp } = setup({
        focusItem: 'overdue-1',
        overdueTasks: [buildTask('overdue-1')],
        isTodayList: true,
      });
      cmp.isOverdueHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isOverdueHidden()).toBe(false);
    });

    it('expands the collapsed Later Today panel for a later-today task', () => {
      const { cmp } = setup({
        focusItem: 'later-1',
        laterTodayTasks: [buildTask('later-1')],
        isTodayList: true,
      });
      cmp.isLaterTodayHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isLaterTodayHidden()).toBe(false);
    });

    it('leaves the Today-only panels alone outside the Today list', () => {
      // The overdue and later-today LISTS are global, but their panels only
      // render on Today. Flipping them from a project page would silently drop a
      // collapse preference for a panel that is not even on screen — and could
      // never reveal anything, since the row is not rendered here either.
      const { cmp } = setup({
        focusItem: 'overdue-1',
        overdueTasks: [buildTask('overdue-1')],
        laterTodayTasks: [buildTask('overdue-1')],
        isTodayList: false,
      });
      cmp.isOverdueHidden.set(true);
      cmp.isLaterTodayHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isOverdueHidden()).toBe(true);
      expect(cmp.isLaterTodayHidden()).toBe(true);
    });

    it('opens only the first panel that holds the task, never all of them', () => {
      // A reveal that expanded every panel would undo collapse state the user set
      // deliberately. Here the three lists hold different tasks; the overlap case
      // is covered below.
      const { cmp } = setup({
        focusItem: 'done-1',
        doneTasks: [buildTask('done-1')],
        overdueTasks: [buildTask('overdue-1')],
        laterTodayTasks: [buildTask('later-1')],
        isTodayList: true,
      });
      cmp.isDoneHidden.set(true);
      cmp.isOverdueHidden.set(true);
      cmp.isLaterTodayHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isDoneHidden()).toBe(false);
      expect(cmp.isOverdueHidden()).toBe(true);
      expect(cmp.isLaterTodayHidden()).toBe(true);
    });

    it('opens one panel when the task is in two lists at once', () => {
      // The panel lists genuinely overlap, because membership matches nested
      // subtasks and the selectors attach the whole subtask family: an undone
      // overdue subtask of a DONE parent is in doneTasks (nested) and in
      // overdueTasks (top-level). Opening Done alone is correct — the row renders
      // there under its parent — but it is a choice, so pin it.
      const doneParent = buildTask('done-parent', [buildTask('overdue-sub')]);
      const { cmp } = setup({
        focusItem: 'overdue-sub',
        doneTasks: [doneParent],
        overdueTasks: [buildTask('overdue-sub')],
        isTodayList: true,
      });
      cmp.isDoneHidden.set(true);
      cmp.isOverdueHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(cmp.isDoneHidden()).toBe(false);
      expect(cmp.isOverdueHidden()).toBe(true);
    });

    it('expands nothing while a plugin embed replaces the task list', () => {
      // `#splitTopEl` is outside the plugin `@if`, so the loop keeps its
      // container and runs its full budget with no rows to find. Expanding here
      // would push a synced updateSection for a section nobody can see.
      const { cmp, updateSection } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        sections: [buildCollapsibleSection('s1', ['wanted'])],
        doneTasks: [buildTask('done-1')],
        embedPluginId: 'some-plugin',
      });
      cmp.isDoneHidden.set(true);

      retriggerFocusAttempt(cmp);

      expect(updateSection).not.toHaveBeenCalled();
      expect(cmp.isDoneHidden()).toBe(true);
    });

    it('expands the group once the grouped list arrives on a later retry', fakeAsync(() => {
      // The customized list is deferred by one animation frame, so the first
      // attempt sees no groups at all. Retrying is the ONLY reason this case
      // works — the reveal has to survive data that arrives after it starts.
      const customized$ = new BehaviorSubject<CustomizedStub>({
        list: [buildTask('wanted')],
      });
      const { toggleGroupExpansion } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        customized$,
        collapsedGroupIds: ['groupA'],
      });
      expect(toggleGroupExpansion).not.toHaveBeenCalled();

      customized$.next({
        list: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
      });
      tick(250);

      expect(toggleGroupExpansion).toHaveBeenCalledWith('groupA');
      discardPeriodicTasks();
    }));

    it('expands the section once the sections arrive on a later retry', fakeAsync(() => {
      const sections$ = new BehaviorSubject<readonly Section[]>([]);
      const { cmp, updateSection } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        sections$,
      });
      // No panel may be opened on the way: while the sections are still missing
      // the attempt falls through to the panel checks, and this task is in none
      // of those lists.
      cmp.isDoneHidden.set(true);
      expect(updateSection).not.toHaveBeenCalled();

      sections$.next([buildCollapsibleSection('s1', ['wanted'])]);
      tick(250);

      expect(updateSection).toHaveBeenCalledWith('s1', { isExpanded: true });
      expect(cmp.isDoneHidden()).toBe(true);
      discardPeriodicTasks();
    }));

    it('stops expanding once focusItem leaves the url', fakeAsync(() => {
      // The spy leaves collapsedGroupIds untouched, so an uncancelled loop keeps
      // re-expanding — which is what makes this observable at all.
      const queryParams$ = new BehaviorSubject<Record<string, string>>({
        focusItem: 'wanted',
      });
      const { toggleGroupExpansion } = setup({
        queryParams$,
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: ['groupA'],
      });
      tick(250);
      const callsWhileFocused = toggleGroupExpansion.calls.count();
      expect(callsWhileFocused).toBeGreaterThan(0);

      queryParams$.next({});
      tick(2000);

      expect(toggleGroupExpansion.calls.count()).toBe(callsWhileFocused);
      discardPeriodicTasks();
    }));

    it('does not replay the reveal on a later re-mount once it has given up', fakeAsync(() => {
      const { cmp, toggleGroupExpansion } = setup({
        focusItem: 'wanted',
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: ['groupA'],
      });
      // Burn the whole retry budget (21 attempts × 250ms).
      tick(6000);
      const callsAfterGivingUp = toggleGroupExpansion.calls.count();

      // A context change re-creates splitTopEl, which restarts a pending reveal.
      cmp.splitTopElRef = new ElementRef(document.createElement('div'));
      tick(6000);

      expect(toggleGroupExpansion.calls.count()).toBe(callsAfterGivingUp);
      discardPeriodicTasks();
    }));

    it('does not touch any container without a focusItem', () => {
      const { toggleGroupExpansion, updateSection } = setup({
        undone: [buildTask('wanted')],
        grouped: { groupA: [buildTask('wanted')] },
        collapsedGroupIds: ['groupA'],
        sections: [buildCollapsibleSection('s1', ['wanted'])],
      });

      expect(toggleGroupExpansion).not.toHaveBeenCalled();
      expect(updateSection).not.toHaveBeenCalled();
    });
  });
});
