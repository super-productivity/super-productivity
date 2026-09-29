import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TaskPriorityIndicatorComponent } from './task-priority-indicator.component';
import {
  TASK_PRIORITY_CHEVRON_ICON,
  TASK_PRIORITY_LABEL_KEY,
} from '../task-priority.const';
import { TaskPriority } from '../task.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskPriorityIconPreset, TasksConfig } from '../../config/global-config.model';

describe('TaskPriorityIndicatorComponent', () => {
  let cfg: WritableSignal<{ tasks?: Partial<TasksConfig> } | undefined>;

  const create = (
    priority: TaskPriority,
    isDecorative = false,
  ): ComponentFixture<TaskPriorityIndicatorComponent> => {
    const fixture = TestBed.createComponent(TaskPriorityIndicatorComponent);
    fixture.componentRef.setInput('priority', priority);
    fixture.componentRef.setInput('isDecorative', isDecorative);
    fixture.detectChanges();
    return fixture;
  };
  const setPreset = (preset: TaskPriorityIconPreset | undefined): void =>
    cfg.set({ tasks: { priorityIconPreset: preset } });
  const glyph = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement.querySelector('.glyph');

  beforeEach(() => {
    cfg = signal<{ tasks?: Partial<TasksConfig> } | undefined>(undefined);
    TestBed.configureTestingModule({
      imports: [TaskPriorityIndicatorComponent, TranslateModule.forRoot()],
      providers: [{ provide: GlobalConfigService, useValue: { cfg } }],
    });
  });

  for (const priority of [3, 2, 1] as const) {
    describe(`priority ${priority}`, () => {
      it('exposes the priority as a host attribute, so only its own styles colour it', () => {
        const fixture = create(priority);

        expect(fixture.nativeElement.getAttribute('data-priority')).toBe(`${priority}`);
      });

      it('renders the chevron glyph when no preset is configured', () => {
        const fixture = create(priority);
        const icon: HTMLElement = fixture.nativeElement.querySelector('mat-icon');

        expect(icon.getAttribute('fontIcon')).toBe(TASK_PRIORITY_CHEVRON_ICON[priority]);
      });

      it('renders the stored number for the numbers preset', () => {
        setPreset('numbers');
        const fixture = create(priority);

        expect(fixture.nativeElement.querySelector('mat-icon')).toBeNull();
        expect(fixture.nativeElement.querySelector('.number').dataset.level).toBe(
          `${priority}`,
        );
      });

      it('renders one dot per level for the dots preset', () => {
        setPreset('dots');
        const fixture = create(priority);

        expect(fixture.nativeElement.querySelectorAll('.dot').length).toBe(priority);
      });

      it('labels the glyph for screen readers', () => {
        const fixture = create(priority);

        // With `TranslateModule.forRoot()` and no loader the pipe echoes the key.
        expect(glyph(fixture).getAttribute('role')).toBe('img');
        expect(glyph(fixture).getAttribute('aria-label')).toBe(
          TASK_PRIORITY_LABEL_KEY[priority],
        );
      });
    });
  }

  // Hosts read `textContent` as a label (e.g. mat-option's announced viewValue),
  // so the glyph must not add icon names or digits to it.
  for (const preset of ['chevrons', 'numbers', 'dots'] as const) {
    it(`adds no text content in the ${preset} preset`, () => {
      setPreset(preset);

      expect(create(3).nativeElement.textContent.trim()).toBe('');
    });
  }

  it('uses the iconPreset input over the configured preset', () => {
    setPreset('chevrons');
    const fixture = TestBed.createComponent(TaskPriorityIndicatorComponent);
    fixture.componentRef.setInput('priority', 2);
    fixture.componentRef.setInput('iconPreset', 'dots');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-icon')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.dot').length).toBe(2);
  });

  it('falls back to chevrons for an unknown configured preset', () => {
    cfg.set({ tasks: { priorityIconPreset: 'sparkles' } });

    expect(create(1).nativeElement.querySelector('mat-icon')).not.toBeNull();
  });

  it('switches every rendered glyph when the preset changes', () => {
    const fixture = create(3);
    setPreset('dots');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-icon')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.dot').length).toBe(3);
  });

  it('hides itself from screen readers when decorative', () => {
    const fixture = create(2, true);

    expect(glyph(fixture).getAttribute('aria-hidden')).toBe('true');
    expect(glyph(fixture).getAttribute('role')).toBeNull();
    expect(glyph(fixture).getAttribute('aria-label')).toBeNull();
  });

  // A string priority written by an old test build is only repaired on sync, so a
  // local-only user can still render one. It must not throw, and shows nothing.
  for (const preset of ['chevrons', 'numbers', 'dots'] as const) {
    it(`renders nothing for an unexpected value (${preset})`, () => {
      setPreset(preset);
      let fixture: ComponentFixture<TaskPriorityIndicatorComponent> | undefined;

      expect(() => (fixture = create('high' as unknown as TaskPriority))).not.toThrow();
      expect(glyph(fixture!)).toBeNull();
      expect(fixture!.nativeElement.textContent.trim()).toBe('');
    });
  }
});
