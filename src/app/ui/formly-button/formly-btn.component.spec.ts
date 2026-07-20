import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyBtnComponent } from './formly-btn.component';
import { Log } from '../../core/log';

@Component({
  selector: 'formly-btn-host',
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
class FormlyBtnHostComponent {
  form = new UntypedFormGroup({});
  model: Record<string, unknown> = {};
  fields: FormlyFieldConfig[] = [];
}

describe('FormlyBtnComponent', () => {
  let fixture: ComponentFixture<FormlyBtnHostComponent>;
  let host: FormlyBtnHostComponent;

  const setup = async (onClick: () => unknown): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [
        FormlyBtnHostComponent,
        FormlyBtnComponent,
        FormlyModule.forRoot({
          types: [{ name: 'btn', component: FormlyBtnComponent, wrappers: [] }],
        }),
        TranslateModule.forRoot(),
      ],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyBtnHostComponent);
    host = fixture.componentInstance;
    host.fields = [
      {
        key: 'localRestApiToken',
        type: 'btn',
        templateOptions: {
          text: 'Regenerate Access Token',
          onClick,
        },
      },
    ];
    fixture.detectChanges();
  };

  const clickButton = async (): Promise<void> => {
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('writes synchronous primitive return values and marks the form dirty', async () => {
    const token = 'new_local_rest_api_token';
    await setup(() => token);

    expect(() =>
      fixture.debugElement.query(By.css('button')).nativeElement.click(),
    ).not.toThrow();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.form.value.localRestApiToken).toBe(token);
    expect(host.form.dirty).toBe(true);
  });

  it('does not log resolved async values', async () => {
    const logSpy = spyOn(Log, 'log');
    const token = 'async_local_rest_api_token';
    await setup(() => Promise.resolve(token));

    await clickButton();

    expect(host.form.value.localRestApiToken).toBe(token);
    expect(host.form.dirty).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
