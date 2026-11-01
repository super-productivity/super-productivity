import { Component, signal, viewChild, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenuTrigger } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TranslateModule } from '@ngx-translate/core';
import { TaskViewCustomizerPanelComponent } from './task-view-customizer-panel.component';
import { TaskViewCustomizerService } from '../task-view-customizer.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { WorkContextService } from '../../work-context/work-context.service';
import {
  DEFAULT_OPTIONS,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
  GroupOption,
  OPTIONS,
  SortOption,
} from '../types';
import { T } from '../../../t.const';

@Component({
  standalone: true,
  imports: [TaskViewCustomizerPanelComponent, MatMenuTrigger],
  template: `
    <button [matMenuTriggerFor]="null">open</button>
    <task-view-customizer-panel></task-view-customizer-panel>
  `,
})
class HostComponent {
  readonly panel = viewChild.required(TaskViewCustomizerPanelComponent);
  readonly trigger = viewChild.required(MatMenuTrigger);
}

describe('TaskViewCustomizerPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
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

  it('shows grouping, "Save as view…" and "Reset all"', () => {
    const texts = openMenuTexts();
    expect(texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY))).toBeTrue();
    expect(texts.some((t) => t.includes(T.F.BOARDS.V.SAVE_AS_VIEW))).toBeTrue();
    expect(texts.some((t) => t.includes(T.F.TASK_VIEW.CUSTOMIZER.RESET_ALL))).toBeTrue();
  });

  it("writes the list's customizer state", () => {
    fixture.detectChanges();
    cmp().onFilterWithValue({
      filterType: FILTER_OPTION_TYPE.deadline,
      preset: FILTER_SCHEDULE.today,
    });
    expect(customizer.setFilter).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: FILTER_OPTION_TYPE.deadline,
        preset: FILTER_SCHEDULE.today,
      }),
    );
  });
});
