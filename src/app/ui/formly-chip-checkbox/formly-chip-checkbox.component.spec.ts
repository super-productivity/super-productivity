import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlyChipCheckboxComponent } from './formly-chip-checkbox.component';
import { FormlyLabelledGroupWrapperComponent } from '../formly-labelled-group/formly-labelled-group.wrapper';

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
  model = { monday: true, tuesday: false };
  fields: FormlyFieldConfig[] = [
    {
      wrappers: ['labelled-group'],
      props: { label: 'Repeat on' },
      fieldGroup: [
        {
          key: 'monday',
          type: 'chip-checkbox',
          props: { label: 'Monday', shortLabel: 'Mon' },
        },
        { key: 'tuesday', type: 'chip-checkbox', props: { label: 'Tuesday' } },
      ],
    },
  ];
}

describe('FormlyChipCheckboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  const checkbox = (name: string): HTMLInputElement =>
    el.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        FormlyModule.forRoot({
          types: [
            {
              name: 'chip-checkbox',
              component: FormlyChipCheckboxComponent,
              wrappers: [],
            },
          ],
          wrappers: [
            { name: 'labelled-group', component: FormlyLabelledGroupWrapperComponent },
          ],
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('is a native checkbox named by its label, showing the short label', () => {
    expect(checkbox('Monday').type).toBe('checkbox');
    expect(checkbox('Monday').checked).toBe(true);
    expect(checkbox('Monday').closest('label')?.textContent?.trim()).toBe('Mon');
    expect(checkbox('Tuesday').closest('label')?.textContent?.trim()).toBe('Tuesday');
  });

  it('updates the model when the chip is clicked', () => {
    (checkbox('Tuesday').closest('label') as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.form.value).toEqual({ monday: true, tuesday: true });
  });

  it('names the row of chips as a group', () => {
    const group = el.querySelector('[role="group"]') as HTMLElement;
    const labelId = group.getAttribute('aria-labelledby') as string;

    expect(el.querySelector(`#${CSS.escape(labelId)}`)?.textContent?.trim()).toBe(
      'Repeat on',
    );
    expect(group.querySelectorAll('input[type="checkbox"]').length).toBe(2);
  });
});
