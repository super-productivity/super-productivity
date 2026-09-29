import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PriorityIconPresetSelectComponent } from './priority-icon-preset-select.component';
import { GlobalConfigService } from '../global-config.service';
import { T } from '../../../t.const';
import { TaskPriorityIconPreset } from '../global-config.model';

describe('PriorityIconPresetSelectComponent', () => {
  let fixture: ComponentFixture<PriorityIconPresetSelectComponent>;
  let formControl: FormControl<TaskPriorityIconPreset | null>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PriorityIconPresetSelectComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      // The configured preset is chevrons: previews must ignore it.
      providers: [
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal({ tasks: { priorityIconPreset: 'chevrons' } }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PriorityIconPresetSelectComponent);
    formControl = new FormControl<TaskPriorityIconPreset | null>('dots');
    Object.defineProperty(fixture.componentInstance, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    fixture.componentInstance.field = {
      props: {},
      options: { showError: () => false },
    } as FormlyFieldConfig;
    fixture.detectChanges();
    // MatSelect applies the initial value in a microtask.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const openOptions = (): HTMLElement[] => {
    fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
  };

  it('previews the selected preset, not the configured one, in the closed field', () => {
    const trigger: HTMLElement =
      fixture.nativeElement.querySelector('mat-select-trigger');

    expect(trigger.textContent).toContain(T.GCF.TASKS.PRIORITY_ICON_PRESET_DOTS);
    expect(trigger.querySelectorAll('task-priority-indicator').length).toBe(3);
    expect(trigger.querySelectorAll('.dot').length).toBe(3 + 2 + 1);
    expect(trigger.querySelector('mat-icon')).toBeNull();
  });

  it('previews High, Medium and Low for every preset option', () => {
    const [chevrons, numbers, dots] = openOptions();

    expect(chevrons.textContent).toContain(T.GCF.TASKS.PRIORITY_ICON_PRESET_CHEVRONS);
    expect(chevrons.querySelectorAll('mat-icon').length).toBe(3);
    expect(
      Array.from(numbers.querySelectorAll('.number')).map((n) => n.textContent?.trim()),
    ).toEqual(['3', '2', '1']);
    expect(dots.querySelectorAll('.dot').length).toBe(6);
  });

  it('writes the picked preset to the form control', () => {
    openOptions()[1].click();

    expect(formControl.value).toBe('numbers');
  });
});
