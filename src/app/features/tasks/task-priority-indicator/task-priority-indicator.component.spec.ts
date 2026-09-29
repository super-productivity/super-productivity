import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TaskPriorityIndicatorComponent } from './task-priority-indicator.component';
import { TASK_PRIORITY_ICONS, TASK_PRIORITY_LABEL_KEY } from '../task-priority.const';
import { TaskPriority } from '../task.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskPriorityIconPreset, TasksConfig } from '../../config/global-config.model';

describe('TaskPriorityIndicatorComponent', () => {
  let cfg: WritableSignal<{ tasks?: Partial<TasksConfig> } | undefined>;

  const create = (
    priority: TaskPriority,
    iconPreset?: TaskPriorityIconPreset,
  ): ComponentFixture<TaskPriorityIndicatorComponent> => {
    const fixture = TestBed.createComponent(TaskPriorityIndicatorComponent);
    fixture.componentRef.setInput('priority', priority);
    if (iconPreset) {
      fixture.componentRef.setInput('iconPreset', iconPreset);
    }
    fixture.detectChanges();
    return fixture;
  };
  const icon = (fixture: ComponentFixture<unknown>): HTMLElement | null =>
    fixture.nativeElement.querySelector('mat-icon');
  const setConfiguredPreset = (preset: string | undefined): void =>
    cfg.set({ tasks: { priorityIconPreset: preset } });

  beforeEach(() => {
    cfg = signal<{ tasks?: Partial<TasksConfig> } | undefined>(undefined);
    TestBed.configureTestingModule({
      imports: [TaskPriorityIndicatorComponent, TranslateModule.forRoot()],
      providers: [{ provide: GlobalConfigService, useValue: { cfg } }],
    });
  });

  for (const priority of [1, 2, 3] as const) {
    it(`exposes priority ${priority} as a host attribute for its colour`, () => {
      expect(create(priority).nativeElement.getAttribute('data-priority')).toBe(
        `${priority}`,
      );
    });

    it(`labels priority ${priority} for screen readers`, () => {
      const el = icon(create(priority))!;

      // With `TranslateModule.forRoot()` and no loader the pipe echoes the key.
      expect(el.getAttribute('role')).toBe('img');
      expect(el.getAttribute('aria-label')).toBe(TASK_PRIORITY_LABEL_KEY[priority]);
      // MatIcon force-sets aria-hidden="true" unless a static value is present.
      expect(el.getAttribute('aria-hidden')).toBe('false');
    });
  }

  for (const preset of ['chevrons', 'numbers', 'bars'] as const) {
    it(`renders the ${preset} icon for each level, without a text node`, () => {
      setConfiguredPreset(preset);

      for (const priority of [1, 2, 3] as const) {
        const fixture = create(priority);
        expect(icon(fixture)!.getAttribute('fontIcon')).toBe(
          TASK_PRIORITY_ICONS[preset][priority],
        );
        // Hosts read textContent as a label (e.g. mat-option's viewValue).
        expect(fixture.nativeElement.textContent.trim()).toBe('');
      }
    });
  }

  it('uses chevrons when no preset is configured', () => {
    expect(icon(create(3))!.getAttribute('fontIcon')).toBe(
      TASK_PRIORITY_ICONS.chevrons[3],
    );
  });

  it('falls back to chevrons for an unknown configured preset', () => {
    setConfiguredPreset('sparkles');

    expect(icon(create(1))!.getAttribute('fontIcon')).toBe(
      TASK_PRIORITY_ICONS.chevrons[1],
    );
  });

  it('prefers the iconPreset input over the configured preset', () => {
    setConfiguredPreset('chevrons');

    expect(icon(create(2, 'bars'))!.getAttribute('fontIcon')).toBe(
      TASK_PRIORITY_ICONS.bars[2],
    );
  });

  it('follows a change of the configured preset', () => {
    const fixture = create(3);
    setConfiguredPreset('numbers');
    fixture.detectChanges();

    expect(icon(fixture)!.getAttribute('fontIcon')).toBe(TASK_PRIORITY_ICONS.numbers[3]);
  });

  // A string priority written by an old test build is only repaired on sync, so a
  // local-only user can still render one. It must not throw, and shows nothing.
  it('renders nothing for an unexpected value', () => {
    let fixture: ComponentFixture<TaskPriorityIndicatorComponent> | undefined;

    expect(() => (fixture = create('high' as unknown as TaskPriority))).not.toThrow();
    expect(icon(fixture!)).toBeNull();
    expect(fixture!.nativeElement.getBoundingClientRect().width).toBe(0);
  });
});
