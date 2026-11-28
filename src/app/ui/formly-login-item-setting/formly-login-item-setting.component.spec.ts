import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyLoginItemSettingComponent } from './formly-login-item-setting.component';

describe('FormlyLoginItemSettingComponent', () => {
  let fixture: ComponentFixture<FormlyLoginItemSettingComponent>;
  let component: FormlyLoginItemSettingComponent;

  const setEa = (api: Record<string, unknown>): void => {
    (window as unknown as { ea: unknown }).ea = {
      getOpenAtLogin: jasmine.createSpy().and.resolveTo(false),
      ...api,
    };
  };

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const checkboxInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('mat-checkbox input');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FormlyLoginItemSettingComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyLoginItemSettingComponent);
    component = fixture.componentInstance;
    // Keyless field: no formControl, only the wrapper field object.
    component.field = { props: {}, templateOptions: {} } as never;
  });

  afterEach(() => {
    delete (window as unknown as { ea?: unknown }).ea;
  });

  it('shows the OS login item on init', async () => {
    setEa({ getOpenAtLogin: jasmine.createSpy().and.resolveTo(true) });

    fixture.detectChanges();
    await settle();

    expect(checkboxInput().checked).toBe(true);
    expect(checkboxInput().disabled).toBe(false);
  });

  it('sets the login item over IPC', async () => {
    const setOpenAtLogin = jasmine.createSpy('setOpenAtLogin').and.resolveTo(true);
    setEa({ setOpenAtLogin });
    fixture.detectChanges();
    await settle();

    checkboxInput().click();
    fixture.detectChanges();
    await settle();

    expect(setOpenAtLogin).toHaveBeenCalledOnceWith(true);
    expect(checkboxInput().checked).toBe(true);
  });

  it('unticks the box again when the OS refuses the login item', async () => {
    setEa({ setOpenAtLogin: jasmine.createSpy().and.resolveTo(false) });
    fixture.detectChanges();
    await settle();

    checkboxInput().click();
    fixture.detectChanges();
    await settle();

    expect(checkboxInput().checked).toBe(false);
    expect(component.isOpenAtLogin()).toBe(false);
  });

  it('unticks the box again when the change fails', async () => {
    setEa({ setOpenAtLogin: jasmine.createSpy().and.rejectWith(new Error('IPC')) });
    fixture.detectChanges();
    await settle();

    checkboxInput().click();
    fixture.detectChanges();
    await settle();

    expect(checkboxInput().checked).toBe(false);
    expect(component.isSaving()).toBe(false);
  });

  it('stays disabled without the Electron bridge', async () => {
    fixture.detectChanges();
    await settle();

    expect(checkboxInput().disabled).toBe(true);
  });
});
