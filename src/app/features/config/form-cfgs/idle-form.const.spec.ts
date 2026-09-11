import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { IDLE_FORM_CFG } from './idle-form.const';
import { ConfigFormComponent } from '../config-form/config-form.component';
import { FormlyConfigModule } from '../../../ui/formly-config.module';
import { IDLE_MIN_IDLE_TIME_MS } from '../../../../../electron/shared-with-frontend/idle.const';
import EN_TRANSLATIONS from '../../../../assets/i18n/en.json';

/**
 * #9349: the Electron main process never sends IPC.IDLE_TIME for idle periods
 * at or below `CONFIG.MIN_IDLE_TIME`, so any `minIdleTime` below that floor is
 * silently rounded up to it — the dialog opens at roughly 1–1.5 min however low
 * the setting is. The bound makes that unhonourable range impossible to enter.
 *
 * These tests mount the REAL IDLE_FORM_CFG through the REAL ConfigFormComponent
 * and the REAL Formly `duration` type registration, because the fix is a single
 * `min` prop on a custom field type — a prop the type could have ignored.
 */
describe('IDLE_FORM_CFG minIdleTime lower bound (#9349)', () => {
  let fixture: ComponentFixture<ConfigFormComponent>;
  let component: ConfigFormComponent;

  const setMinIdleTime = (ms: number): void => {
    const control = component.form.get('minIdleTime');
    if (!control) {
      throw new Error('minIdleTime control not built by formly');
    }
    control.setValue(ms);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigFormComponent, FormlyConfigModule, TranslateModule.forRoot()],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', EN_TRANSLATIONS);
    translate.use('en');

    fixture = TestBed.createComponent(ConfigFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('sectionKey', 'idle');
    fixture.componentRef.setInput('formCfg', IDLE_FORM_CFG.items as FormlyFieldConfig[]);
    // minIdleTime is behind `hideExpression: '!model.isEnableIdleTimeTracking'`,
    // so the control only exists when idle tracking is on.
    fixture.componentRef.setInput('cfg', {
      isEnableIdleTimeTracking: true,
      minIdleTime: 5 * 60 * 1000,
      isOnlyOpenIdleWhenCurrentTask: false,
      isSuppressIdleDuringFocusMode: false,
    });
    fixture.detectChanges();
  });

  it('should build a minIdleTime control that is valid at the default', () => {
    expect(component.form.get('minIdleTime')).toBeTruthy();
    expect(component.form.valid).toBe(true);
  });

  it('should reject a value below the Electron idle floor', () => {
    setMinIdleTime(30 * 1000);

    expect(component.form.get('minIdleTime')?.errors?.['min']).toBeTruthy();
    expect(component.form.valid).toBe(false);
  });

  it('should reject 0', () => {
    setMinIdleTime(0);

    expect(component.form.get('minIdleTime')?.errors?.['min']).toBeTruthy();
    expect(component.form.valid).toBe(false);
  });

  it('should accept exactly the Electron idle floor', () => {
    setMinIdleTime(IDLE_MIN_IDLE_TIME_MS);

    expect(component.form.get('minIdleTime')?.errors).toBeNull();
    expect(component.form.valid).toBe(true);
  });

  // A value change flows through `(modelChange)="updateCfg($event)"`, which is
  // the only route from this form to the persisted config.
  it('should not emit save for a below-floor value', () => {
    const saveSpy = jasmine.createSpy('save');
    component.save.subscribe(saveSpy);

    setMinIdleTime(30 * 1000);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should emit save once the value is back at the floor', () => {
    const saveSpy = jasmine.createSpy('save');
    component.save.subscribe(saveSpy);

    setMinIdleTime(IDLE_MIN_IDLE_TIME_MS);

    expect(saveSpy).toHaveBeenCalled();
  });

  // Someone who already stored a sub-floor value opens the section with an
  // invalid form. Turning idle tracking off must still save, otherwise the new
  // bound would strand them in a section they cannot change.
  it('should still save when idle tracking is switched off with a below-floor value', () => {
    const saveSpy = jasmine.createSpy('save');
    setMinIdleTime(30 * 1000);
    component.save.subscribe(saveSpy);

    component.form.get('isEnableIdleTimeTracking')?.setValue(false);
    fixture.detectChanges();

    expect(component.form.get('minIdleTime')).toBeNull();
    expect(component.form.valid).toBe(true);
    expect(saveSpy).toHaveBeenCalled();
  });

  // The bound is only half the fix: the field has to say what it is, with both
  // numbers interpolated from the shared const rather than baked into the copy.
  it('should name the floor and the poll interval in the description', () => {
    const hint = (fixture.nativeElement as HTMLElement).querySelector('mat-hint');

    expect(hint?.textContent).toContain('at least 1m');
    expect(hint?.textContent).toContain('every 30s');
  });

  it('should show the floor as a readable duration, not raw milliseconds', () => {
    setMinIdleTime(30 * 1000);
    component.form.get('minIdleTime')?.markAsTouched();
    fixture.detectChanges();

    const errorText = (fixture.nativeElement as HTMLElement).querySelector(
      'mat-error',
    )?.textContent;

    expect(errorText).toContain('1m');
    expect(errorText).not.toContain('60000');
  });
});
