import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { ScheduleTrayComponent } from './schedule-tray.component';
import { ScheduleWeekDragService } from '../schedule-week/schedule-week-drag.service';
import { ScheduleDayTray } from '../schedule.model';
import { TaskCopy } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';

const H = 60 * 60 * 1000;
const MON = '2026-01-05';
const TUE = '2026-01-06';
const NOT_SHOWN = '2026-01-09';

const fakeTask = (id: string): TaskCopy =>
  ({
    id,
    title: `Task ${id}`,
    subTaskIds: [],
    timeSpent: 0,
    timeEstimate: H,
  }) as Partial<TaskCopy> as TaskCopy;

const fakeTray = (ids: string[], freeMs?: number): ScheduleDayTray => ({
  tasks: ids.map(fakeTask),
  repeatCfgs: [],
  plannedMs: ids.length * H,
  freeMs,
});

describe('ScheduleTrayComponent', () => {
  let fixture: ComponentFixture<ScheduleTrayComponent>;
  let taskService: jasmine.SpyObj<TaskService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let isXs: ReturnType<typeof signal<boolean>>;

  const el = (): HTMLElement => fixture.nativeElement;
  const texts = (selector: string): string[] =>
    Array.from(el().querySelectorAll(selector)).map((node) =>
      (node.textContent || '').replace(/\s+/g, ' ').trim(),
    );
  const render = (
    trays: Record<string, ScheduleDayTray>,
    isHorizontalScroll = false,
  ): void => {
    fixture.componentRef.setInput('days', [MON, TUE]);
    fixture.componentRef.setInput('trays', trays);
    fixture.componentRef.setInput('isHorizontalScroll', isHorizontalScroll);
    fixture.detectChanges();
  };

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', ['setSelectedId']);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    isXs = signal(false);
    TestBed.configureTestingModule({
      imports: [ScheduleTrayComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ScheduleWeekDragService,
          useValue: {
            dragOverTrayDay: signal<string | null>(null),
            currentDragEvent: signal(null),
            dragPreviewStyle: signal(null),
          },
        },
        { provide: TaskService, useValue: taskService },
        { provide: MatDialog, useValue: matDialog },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal({ keyboard: { taskSchedule: 'S' } }) },
        },
        { provide: LayoutService, useValue: { isXs } },
      ],
    });
    fixture = TestBed.createComponent(ScheduleTrayComponent);
  });

  it('keeps an expanded day bounded and lets its last task scroll into view', () => {
    render({ [MON]: fakeTray(Array.from({ length: 30 }, (_, i) => `task-${i}`)) });
    fixture.componentInstance.isExpanded.set(true);
    fixture.detectChanges();
    const cell = el().querySelector<HTMLElement>('.tray-cell')!;
    const lastChip = cell.querySelector<HTMLElement>('.chip:last-child')!;
    expect(Math.round(cell.getBoundingClientRect().height)).toBeLessThanOrEqual(
      Math.ceil(window.innerHeight * 0.3),
    );
    expect(cell.scrollHeight).toBeGreaterThan(cell.clientHeight);
    cell.scrollTop = cell.scrollHeight;
    expect(lastChip.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      cell.getBoundingClientRect().bottom,
    );
  });

  it('renders nothing while no shown day has tasks without a time', () => {
    render({ [MON]: fakeTray([]), [NOT_SHOWN]: fakeTray(['A']) });

    expect(el().children.length).toBe(0);
  });

  it('gives every shown day a cell once one of them has tasks', () => {
    render({ [MON]: fakeTray(['A']) });

    const cells = Array.from(el().querySelectorAll('.tray-cell'));
    expect(cells.map((cell) => cell.getAttribute('data-tray-day'))).toEqual([MON, TUE]);
    expect(cells[1].children.length).toBe(0);
  });

  it('shows three tasks per day and expands the rest for all days', () => {
    render({
      [MON]: fakeTray(['A', 'B', 'C', 'D', 'E']),
      [TUE]: fakeTray(['F', 'G', 'H', 'I']),
    });

    expect(texts('.chip-title')).toEqual([
      'Task A',
      'Task B',
      'Task C',
      'Task F',
      'Task G',
      'Task H',
    ]);
    const toggles = el().querySelectorAll<HTMLButtonElement>('.toggle');
    expect(toggles.length).toBe(2);

    toggles[0].click();
    fixture.detectChanges();

    expect(texts('.chip-title').length).toBe(9);

    el().querySelector<HTMLButtonElement>('.toggle')?.click();
    fixture.detectChanges();

    expect(texts('.chip-title').length).toBe(6);
  });

  it('shows two tasks per day on a phone', () => {
    isXs.set(true);
    render({ [MON]: fakeTray(['A', 'B', 'C']) });

    expect(texts('.chip-title')).toEqual(['Task A', 'Task B']);
  });

  it('marks a day that is over capacity', () => {
    render({ [MON]: fakeTray(['A'], -2 * H), [TUE]: fakeTray(['B'], H) });

    const capacities = Array.from(el().querySelectorAll('.capacity'));
    expect(capacities.map((node) => node.classList.contains('is-over'))).toEqual([
      true,
      false,
    ]);
  });

  it('opens the task when its chip is clicked', () => {
    render({ [MON]: fakeTray(['A', 'B']) });

    el().querySelectorAll<HTMLButtonElement>('.chip-main')[1].click();

    expect(taskService.setSelectedId).toHaveBeenCalledOnceWith('B');
  });

  it('opens the schedule dialog for the day with the schedule shortcut', () => {
    render({ [TUE]: fakeTray(['A']) });
    const chip = el().querySelector<HTMLButtonElement>('.chip-main');

    chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX' }));
    expect(matDialog.open).not.toHaveBeenCalled();

    chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' }));
    expect(matDialog.open).toHaveBeenCalledOnceWith(
      DialogScheduleTaskComponent,
      jasmine.objectContaining({
        data: { task: jasmine.objectContaining({ id: 'A' }), targetDay: TUE },
      }),
    );
  });

  it('keeps the tasks visible in a scrolling week that is wider than a phone', () => {
    render({ [TUE]: fakeTray(['A', 'B'], H) }, true);

    expect(texts('.chip-title')).toEqual(['Task A', 'Task B']);
    expect(el().querySelector('.summary')).toBeNull();
  });

  it("shows count and free time in a phone's scrolling week and opens the day on click", () => {
    isXs.set(true);
    const opened: string[] = [];
    fixture.componentInstance.openDay.subscribe((day) => opened.push(day));
    render({ [TUE]: fakeTray(['A', 'B'], H) }, true);

    expect(el().querySelectorAll('.chip').length).toBe(0);
    const summary = el().querySelector<HTMLButtonElement>('.summary');
    expect((summary?.textContent || '').trim().startsWith('2')).toBe(true);

    summary?.click();

    expect(opened).toEqual([TUE]);
  });
});
