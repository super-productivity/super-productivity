import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule, provideFormlyConfig } from '@ngx-formly/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  PRIORITY_ICON_PRESET_SELECT_FORMLY_CONFIG,
  PriorityIconPresetSelectComponent,
} from './priority-icon-preset-select.component';
import { GlobalConfigService } from '../global-config.service';
import { T } from '../../../t.const';
import { TaskPriorityIconPreset } from '../global-config.model';
import { TASKS_SETTINGS_FORM_CFG } from '../form-cfgs/tasks-settings-form.const';

// The configured preset is chevrons: previews must ignore it.
const GLOBAL_CONFIG_MOCK = {
  provide: GlobalConfigService,
  useValue: { cfg: signal({ tasks: { priorityIconPreset: 'chevrons' } }) },
};

const openOptions = (fixture: ComponentFixture<unknown>): HTMLElement[] => {
  fixture.nativeElement.querySelector('.mat-mdc-select-trigger').click();
  fixture.detectChanges();
  return Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
};

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
      providers: [GLOBAL_CONFIG_MOCK],
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

  it('previews the selected preset, not the configured one, in the closed field', () => {
    const trigger: HTMLElement =
      fixture.nativeElement.querySelector('mat-select-trigger');

    expect(trigger.textContent).toContain(T.GCF.TASKS.PRIORITY_ICON_PRESET_DOTS);
    expect(trigger.querySelectorAll('task-priority-indicator').length).toBe(3);
    expect(trigger.querySelectorAll('.dot').length).toBe(1 + 2 + 3);
    expect(trigger.querySelector('mat-icon')).toBeNull();
  });

  it('previews Low, Medium and High, in that order, for every preset option', () => {
    const [chevrons, numbers, dots] = openOptions(fixture);

    expect(chevrons.querySelectorAll('mat-icon').length).toBe(3);
    expect(
      Array.from(numbers.querySelectorAll<HTMLElement>('.number')).map(
        (n) => n.dataset.level,
      ),
    ).toEqual(['1', '2', '3']);
    expect(
      Array.from(dots.querySelectorAll('task-priority-indicator')).map(
        (i) => i.querySelectorAll('.dot').length,
      ),
    ).toEqual([1, 2, 3]);
  });

  // MatSelect announces an option's textContent (viewValue) on arrow keys.
  it('keeps each option label free of icon names or digits', () => {
    const options = openOptions(fixture);

    expect(options.map((o) => o.textContent?.trim())).toEqual([
      T.GCF.TASKS.PRIORITY_ICON_PRESET_CHEVRONS,
      T.GCF.TASKS.PRIORITY_ICON_PRESET_NUMBERS,
      T.GCF.TASKS.PRIORITY_ICON_PRESET_DOTS,
    ]);
  });

  it('writes the picked preset to the form control', () => {
    openOptions(fixture)[1].click();

    expect(formControl.value).toBe('numbers');
  });
});

// Drives the real settings field through <formly-form> with the same config
// main.ts provides, so a type-name mismatch or wrapper problem fails here.
@Component({
  selector: 'preset-form-host',
  standalone: true,
  imports: [FormlyModule],
  template: `<formly-form
    [form]="form"
    [fields]="fields"
    [model]="model"
  ></formly-form>`,
})
class PresetFormHostComponent {
  form = new FormGroup({});
  model: { priorityIconPreset?: string } = {};
  fields = TASKS_SETTINGS_FORM_CFG.items!.filter((f) => f.key === 'priorityIconPreset');
}

describe('PriorityIconPresetSelectComponent in the tasks settings form', () => {
  let fixture: ComponentFixture<PresetFormHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PresetFormHostComponent,
        FormlyModule.forRoot(),
        FormlyMaterialModule,
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      providers: [
        GLOBAL_CONFIG_MOCK,
        provideFormlyConfig(PRIORITY_ICON_PRESET_SELECT_FORMLY_CONFIG),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PresetFormHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders inside a labelled form field and defaults to chevrons', () => {
    const formField: HTMLElement = fixture.nativeElement.querySelector('mat-form-field');

    expect(formField.querySelector('priority-icon-preset-select')).not.toBeNull();
    expect(formField.textContent).toContain(T.GCF.TASKS.PRIORITY_ICON_PRESET);
    expect(fixture.componentInstance.model.priorityIconPreset).toBe('chevrons');
    expect(formField.querySelector('mat-select-trigger')?.textContent).toContain(
      T.GCF.TASKS.PRIORITY_ICON_PRESET_CHEVRONS,
    );
  });

  it('updates the model and the closed-field preview when a preset is picked', async () => {
    openOptions(fixture)[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger: HTMLElement =
      fixture.nativeElement.querySelector('mat-select-trigger');
    expect(fixture.componentInstance.model.priorityIconPreset).toBe('dots');
    expect(trigger.textContent).toContain(T.GCF.TASKS.PRIORITY_ICON_PRESET_DOTS);
    expect(trigger.querySelectorAll('.dot').length).toBe(6);
  });
});
