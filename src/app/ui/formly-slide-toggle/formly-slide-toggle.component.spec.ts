import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlySlideToggleComponent } from './formly-slide-toggle.component';

describe('FormlySlideToggleComponent', () => {
  let fixture: ComponentFixture<FormlySlideToggleComponent>;
  let formControl: FormControl<boolean | null>;

  const setup = (props: FormlyFieldConfig['props']): HTMLElement => {
    fixture = TestBed.createComponent(FormlySlideToggleComponent);
    formControl = new FormControl<boolean | null>(false);
    Object.defineProperty(fixture.componentInstance, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    fixture.componentInstance.field = { id: 'toggle1', props } as FormlyFieldConfig;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const switchBtn = (el: HTMLElement): HTMLButtonElement =>
    el.querySelector('button[role="switch"]') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormlySlideToggleComponent, FormlyModule.forRoot(), NoopAnimationsModule],
    }).compileComponents();
  });

  it('names the switch by its label and describes it by the description', () => {
    const el = setup({ label: 'Planner', description: 'Plan your days.' });

    const btn = switchBtn(el);
    expect(btn.getAttribute('aria-label')).toBe('Planner');
    const descId = btn.getAttribute('aria-describedby') as string;
    expect(el.querySelector(`#${descId}`)?.textContent?.trim()).toBe('Plan your days.');
  });

  it('toggles the value when the label text is clicked', () => {
    const el = setup({ label: 'Planner', description: 'Plan your days.' });

    (el.querySelector('label.row-text') as HTMLElement).click();

    expect(formControl.value).toBe(true);
  });

  it('toggles exactly once when the switch itself is clicked', () => {
    const el = setup({ label: 'Planner', description: 'Plan your days.' });

    switchBtn(el).click();

    expect(formControl.value).toBe(true);
  });

  it('keeps the plain toggle layout without a description', () => {
    const el = setup({ label: 'Planner' });

    expect(el.querySelector('label.row-text')).toBeNull();
    expect(switchBtn(el).getAttribute('aria-label')).toBeNull();
    expect(el.textContent).toContain('Planner');
  });
});
