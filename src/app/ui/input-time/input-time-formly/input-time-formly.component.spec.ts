import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputTimeFormlyComponent } from './input-time-formly.component';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatInputModule } from '@angular/material/input';

describe('InputTimeFormlyComponent', () => {
  let component: InputTimeFormlyComponent;
  let fixture: ComponentFixture<InputTimeFormlyComponent>;
  let formControl: FormControl;

  const getInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('input[type=time]');

  const setup = async (initialValue: string | null): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [
        InputTimeFormlyComponent,
        ReactiveFormsModule,
        FormlyModule.forRoot(),
        BrowserAnimationsModule,
        MatInputModule,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InputTimeFormlyComponent);
    component = fixture.componentInstance;

    formControl = new FormControl(initialValue);
    Object.defineProperty(component, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    component.field = {
      key: 'workStart',
      type: 'time',
      props: {},
      templateOptions: {},
    } as FormlyFieldConfig;

    fixture.detectChanges();
  };

  it('renders a native time input', async () => {
    await setup('09:00');
    expect(getInput()).toBeTruthy();
  });

  it('displays a legacy unpadded model value zero-padded', async () => {
    await setup('9:00');
    expect(getInput().value).toBe('09:00');
  });

  it('writes the canonical HH:mm back to the model on input', async () => {
    await setup('09:00');
    const input = getInput();
    input.value = '17:30';
    input.dispatchEvent(new Event('input'));
    expect(formControl.value).toBe('17:30');
  });

  it('clears the model when the field is emptied', async () => {
    await setup('09:00');
    const input = getInput();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(formControl.value).toBe('');
  });
});
