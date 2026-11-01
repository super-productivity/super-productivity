import { Component, signal, viewChild, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenuTrigger } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { TaskViewCustomizerPanelComponent } from './task-view-customizer-panel.component';
import { TaskViewCustomizerService } from '../task-view-customizer.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { WorkContextService } from '../../work-context/work-context.service';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
} from '../../boards/boards.model';
import { BoardsActions } from '../../boards/store/boards.actions';
import {
  DEFAULT_OPTIONS,
  FILTER_OPTION_TYPE,
  FILTER_PRIORITY,
  FILTER_SCHEDULE,
  FilterOption,
  GroupOption,
  OPTIONS,
  SORT_OPTION_TYPE,
  SortOption,
} from '../types';
import { T } from '../../../t.const';

const panel = (overrides: Partial<BoardPanelCfg> = {}): BoardPanelCfg => ({
  id: 'p1',
  title: 'Panel',
  taskIds: [],
  includedTagIds: [],
  excludedTagIds: [],
  taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
  scheduledState: BoardPanelCfgScheduledState.All,
  isParentTasksOnly: true,
  projectIds: [''],
  ...overrides,
});

@Component({
  standalone: true,
  imports: [TaskViewCustomizerPanelComponent, MatMenuTrigger],
  template: `
    <button [matMenuTriggerFor]="null">open</button>
    <task-view-customizer-panel [view]="view()"></task-view-customizer-panel>
  `,
})
class HostComponent {
  readonly view = signal<BoardCfg | undefined>(undefined);
  readonly panel = viewChild.required(TaskViewCustomizerPanelComponent);
  readonly trigger = viewChild.required(MatMenuTrigger);
}

describe('TaskViewCustomizerPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let dispatch: jasmine.Spy;
  let customizer: {
    selectedSort: WritableSignal<SortOption>;
    selectedGroup: WritableSignal<GroupOption>;
    selectedFilter: WritableSignal<FilterOption>;
    availableGroupOptions: () => GroupOption[];
    setSort: jasmine.Spy;
    setFilter: jasmine.Spy;
  };
  let overlay: HTMLElement;

  beforeEach(async () => {
    dispatch = jasmine.createSpy('dispatch');
    customizer = {
      selectedSort: signal<SortOption>(DEFAULT_OPTIONS.sort),
      selectedGroup: signal<GroupOption>(DEFAULT_OPTIONS.group),
      selectedFilter: signal<FilterOption>(DEFAULT_OPTIONS.filter),
      availableGroupOptions: () => OPTIONS.group.list,
      setSort: jasmine.createSpy('setSort'),
      setFilter: jasmine.createSpy('setFilter'),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: Store, useValue: { dispatch } },
        { provide: TaskViewCustomizerService, useValue: customizer },
        {
          provide: TagService,
          useValue: {
            tagsNoMyDayAndNoListInTreeOrder: signal([{ id: 'work', title: 'Work' }]),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { appFeatures: signal({ isBoardsEnabled: true }) },
        },
        { provide: WorkContextService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  const cmp = (): TaskViewCustomizerPanelComponent => fixture.componentInstance.panel();
  const openMenuTexts = (): string[] => {
    fixture.detectChanges();
    const trigger = fixture.componentInstance.trigger();
    trigger.menu = cmp().menu;
    trigger.openMenu();
    fixture.detectChanges();
    return Array.from(overlay.querySelectorAll('[mat-menu-item]')).map(
      (el) => el.textContent?.trim() ?? '',
    );
  };
  const view = (...panels: BoardPanelCfg[]): BoardCfg => ({
    id: 'v1',
    title: 'View',
    cols: 1,
    panels,
  });

  describe('list mode', () => {
    it('shows grouping, "Save as view…" and "Reset all"', () => {
      const texts = openMenuTexts();
      expect(texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY))).toBeTrue();
      expect(texts.some((t) => t.includes(T.F.BOARDS.V.SAVE_AS_VIEW))).toBeTrue();
      expect(
        texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.RESET_ALL)),
      ).toBeTrue();
    });

    it("reads and writes the list's customizer state", () => {
      const filter: FilterOption = {
        ...OPTIONS.filter.list.find((o) => o.type === FILTER_OPTION_TYPE.priority)!,
        preset: '3',
      };
      customizer.selectedFilter.set(filter);
      fixture.detectChanges();
      expect(cmp().activeFilters()).toEqual({ [FILTER_OPTION_TYPE.priority]: filter });

      cmp().onFilterWithValue({
        filterType: FILTER_OPTION_TYPE.deadline,
        preset: FILTER_SCHEDULE.today,
      });
      expect(customizer.setFilter).toHaveBeenCalledTimes(1);
      cmp().onSortSelect(OPTIONS.sort.list[1]);
      expect(customizer.setSort).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('view mode', () => {
    beforeEach(() => {
      fixture.componentInstance.view.set(
        view(
          panel({ includedTagIds: ['work'], priorityRule: '2' }),
          panel({ id: 'p2', priorityRule: '2' }),
        ),
      );
      fixture.detectChanges();
    });

    it('hides grouping, "Save as view…", "Reset all" and "save sort"', () => {
      const texts = openMenuTexts();
      expect(texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.SORT))).toBeTrue();
      expect(
        texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY)),
      ).toBeFalse();
      expect(texts.some((t) => t.includes(T.F.BOARDS.V.SAVE_AS_VIEW))).toBeFalse();
      expect(
        texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.RESET_ALL)),
      ).toBeFalse();
    });

    it('shows the view rules, not the list state', () => {
      customizer.selectedFilter.set({
        ...OPTIONS.filter.list.find((o) => o.type === FILTER_OPTION_TYPE.deadline)!,
        preset: FILTER_SCHEDULE.today,
      });
      expect(cmp().activeFilters().priority?.preset).toBe('2');
      expect(cmp().activeFilters().deadline).toBeUndefined();
      expect(cmp().differingFilterTypes().tag).toBeTrue();
      expect(cmp().selectedSort()?.type).toBeNull();
    });

    it('dispatches one updateBoard per click and leaves the list state alone', () => {
      cmp().onFilterWithValue({
        filterType: FILTER_OPTION_TYPE.deadline,
        preset: FILTER_SCHEDULE.today,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      const action = dispatch.calls.mostRecent().args[0] as ReturnType<
        typeof BoardsActions.updateBoard
      >;
      expect(action.type).toBe(BoardsActions.updateBoard.type);
      expect(action.id).toBe('v1');
      expect(Object.keys(action.updates)).toEqual(['panels']);
      expect(action.updates.panels!.map((p) => p.deadlineState)).toEqual([
        'today',
        'today',
      ]);

      cmp().onSortSelect(
        OPTIONS.sort.list.find((o) => o.type === SORT_OPTION_TYPE.priority)!,
      );
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(customizer.setFilter).not.toHaveBeenCalled();
      expect(customizer.setSort).not.toHaveBeenCalled();
    });

    it('does not dispatch when the click leaves the panels as stored', () => {
      // Manual sort on an unsorted view.
      cmp().onSortSelect(DEFAULT_OPTIONS.sort);
      expect(dispatch).not.toHaveBeenCalled();

      cmp().onFilterWithValue({
        filterType: FILTER_OPTION_TYPE.priority,
        preset: FILTER_PRIORITY.low,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      const action = dispatch.calls.mostRecent().args[0] as ReturnType<
        typeof BoardsActions.updateBoard
      >;
      expect(action.updates.panels!.map((p) => p.priorityRule)).toEqual(['1', '1']);
    });

    it('does not dispatch for a type that differs per section', () => {
      cmp().onFilterInputChange(FILTER_OPTION_TYPE.tag, 'NOT_SPECIFIED');
      cmp().addTagFilter('work');
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch for a view without panels', () => {
      fixture.componentInstance.view.set(view());
      fixture.detectChanges();
      cmp().onSortSelect(OPTIONS.sort.list[1]);
      cmp().onFilterWithValue({
        filterType: FILTER_OPTION_TYPE.deadline,
        preset: FILTER_SCHEDULE.today,
      });
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
