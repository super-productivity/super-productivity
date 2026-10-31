import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatSelect } from '@angular/material/select';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { FormlyIconSelectComponent } from './formly-icon-select.component';
import { of } from 'rxjs';

const change = jasmine.createSpy('change');

@Component({
  imports: [ReactiveFormsModule, FormlyModule],
  template: `<formly-form
    [form]="form"
    [fields]="fields"
    [model]="model"
  ></formly-form>`,
})
class HostComponent {
  form = new FormGroup({});
  model = { cadence: 'DAILY' };
  fields: FormlyFieldConfig[] = [
    {
      key: 'cadence',
      type: 'icon-select',
      props: {
        label: 'Repeats',
        change,
        options: [
          { value: 'DAILY', label: 'Every day', icon: 'today' },
          { value: 'CUSTOM', label: 'Custom', icon: 'tune' },
          { value: 'PLAIN', label: 'No icon' },
        ],
      },
    },
  ];
}

describe('FormlyIconSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let select: MatSelect;

  beforeEach(async () => {
    change.calls.reset();
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        NoopAnimationsModule,
        FormlyMaterialModule,
        FormlyModule.forRoot({
          types: [
            {
              name: 'icon-select',
              component: FormlyIconSelectComponent,
              extends: 'select',
            },
          ],
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    select = fixture.debugElement.query(By.directive(MatSelect)).componentInstance;
  });

  it('shows the picked option with its icon in the closed field', () => {
    // mat-select picks up its selected option only once its options exist.
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '.mat-mdc-select-value',
    ) as HTMLElement;
    expect(trigger.textContent?.trim()).toBe('Every day');
    expect(trigger.querySelector('mat-icon')?.getAttribute('fontIcon')).toBe('today');
  });

  it('keeps icon names out of the option labels', () => {
    expect(select.options.map((o) => o.viewValue)).toEqual([
      'Every day',
      'Custom',
      'No icon',
    ]);
  });

  // The app's translate extension turns static option arrays into one.
  it('also takes options as an Observable', () => {
    fixture.componentInstance.fields = [
      {
        ...fixture.componentInstance.fields[0],
        props: {
          ...fixture.componentInstance.fields[0].props,
          options: of([
            { value: 'DAILY', label: 'Every day', icon: 'today' },
            { value: 'CUSTOM', label: 'Custom', icon: 'tune' },
          ]),
        },
      },
    ];
    fixture.detectChanges();
    fixture.detectChanges();
    select = fixture.debugElement.query(By.directive(MatSelect)).componentInstance;

    expect(select.options.map((o) => o.viewValue)).toEqual(['Every day', 'Custom']);
  });

  it('updates the model and calls the change hook on selection', () => {
    select.open();
    fixture.detectChanges();
    select.options.get(1)!.select();
    fixture.detectChanges();

    expect(fixture.componentInstance.form.value).toEqual({ cadence: 'CUSTOM' });
    expect(change).toHaveBeenCalledTimes(1);
  });
});
