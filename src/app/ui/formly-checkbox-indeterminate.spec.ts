import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { MatCheckbox } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyConfigModule } from './formly-config.module';

/**
 * Formly's material checkbox defaults `indeterminate` to true and renders it while
 * the value is null, so an untouched checkbox showed "[-]" — reported for the
 * issue-provider dialog, but the same for every checkbox in the app. The fix is a
 * central `defaultOptions` in FormlyConfigModule, so this asserts the rendered
 * control rather than the config object.
 */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormlyModule],
  template: `<form [formGroup]="form">
    <formly-form
      [form]="form"
      [fields]="fields"
      [model]="model"
    ></formly-form>
  </form>`,
})
class HostComponent {
  form = new FormGroup({});
  model: Record<string, unknown> = {};
  fields: FormlyFieldConfig[] = [
    { key: 'noValue', type: 'checkbox', props: { label: 'Untouched' } },
  ];
}

describe('checkbox indeterminate default', () => {
  let fixture: ComponentFixture<HostComponent>;

  const checkbox = (): MatCheckbox =>
    fixture.debugElement.query((el) => el.componentInstance instanceof MatCheckbox)
      .componentInstance as MatCheckbox;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        NoopAnimationsModule,
        FormlyMaterialModule,
        // FormlyConfigModule's own field types translate their labels.
        TranslateModule.forRoot(),
        FormlyConfigModule,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders unticked, not indeterminate, when the value is missing', () => {
    fixture.detectChanges();
    expect(checkbox().indeterminate).toBe(false);
    expect(checkbox().checked).toBe(false);
  });

  it('still reflects an explicit value', () => {
    fixture.componentInstance.model = { noValue: true };
    fixture.detectChanges();
    expect(checkbox().checked).toBe(true);
    expect(checkbox().indeterminate).toBe(false);
  });

  it('lets a field ask for the indeterminate state deliberately', () => {
    // The default is a default, not a ban: a genuinely tri-state field can opt in.
    fixture.componentInstance.fields = [
      { key: 'triState', type: 'checkbox', props: { indeterminate: true } },
    ];
    fixture.detectChanges();
    expect(checkbox().indeterminate).toBe(true);
  });
});
