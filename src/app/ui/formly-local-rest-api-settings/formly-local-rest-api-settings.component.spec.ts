import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyLocalRestApiSettingsComponent } from './formly-local-rest-api-settings.component';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

describe('FormlyLocalRestApiSettingsComponent', () => {
  let fixture: ComponentFixture<FormlyLocalRestApiSettingsComponent>;
  let component: FormlyLocalRestApiSettingsComponent;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;

  const ENABLED_STATE = { isEnabled: true, isListening: true };
  /** Installs a bridge whose API is switched on unless `api` says otherwise. */
  const setEa = (api: Record<string, unknown>): void => {
    (window as unknown as { ea: unknown }).ea = {
      getLocalRestApiState: jasmine.createSpy().and.resolveTo(ENABLED_STATE),
      ...api,
    };
  };

  // Loading reads the state and then the token, two awaited IPC calls, so let
  // the whole chain run before asserting.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    await fixture.whenStable();
  };

  const tokenInputValue = (): string | undefined =>
    fixture.nativeElement.querySelector('.token-value')?.value;

  beforeEach(async () => {
    snackServiceSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        FormlyLocalRestApiSettingsComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: SnackService, useValue: snackServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyLocalRestApiSettingsComponent);
    component = fixture.componentInstance;
    // Keyless display field: no formControl, only the wrapper field object.
    component.field = { props: {}, templateOptions: {} } as never;
  });

  afterEach(() => {
    delete (window as unknown as { ea?: unknown }).ea;
  });

  it('reads the token from IPC on init and renders it', async () => {
    const getLocalRestApiToken = jasmine
      .createSpy('getLocalRestApiToken')
      .and.resolveTo('TOKEN_FROM_IPC');
    setEa({ getLocalRestApiToken });

    fixture.detectChanges(); // ngOnInit
    await settle();
    fixture.detectChanges();

    expect(getLocalRestApiToken).toHaveBeenCalled();
    expect(component.token()).toBe('TOKEN_FROM_IPC');
    // The value must actually reach the DOM, not just the signal — this is the
    // rendering path the previous form-control approach failed on.
    expect(tokenInputValue()).toBe('TOKEN_FROM_IPC');
  });

  it('regenerates via IPC and shows the new token', async () => {
    const getLocalRestApiToken = jasmine
      .createSpy('getLocalRestApiToken')
      .and.resolveTo('OLD_TOKEN');
    const regenerateLocalRestApiToken = jasmine
      .createSpy('regenerateLocalRestApiToken')
      .and.resolveTo('NEW_TOKEN');
    setEa({
      getLocalRestApiToken,
      regenerateLocalRestApiToken,
    });

    fixture.detectChanges();
    await settle();

    await component.regenerate();
    fixture.detectChanges();

    expect(regenerateLocalRestApiToken).toHaveBeenCalledTimes(1);
    expect(component.token()).toBe('NEW_TOKEN');
    expect(tokenInputValue()).toBe('NEW_TOKEN');
  });

  it('reports a failed regeneration instead of pretending it worked', async () => {
    // The main process rejects when the new token could not be stored durably,
    // and keeps the old one live — the user must not be left believing the
    // token on screen was rotated.
    const regenerateLocalRestApiToken = jasmine
      .createSpy('regenerateLocalRestApiToken')
      .and.rejectWith(new Error('EACCES'));
    setEa({
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo('OLD_TOKEN'),
      regenerateLocalRestApiToken,
    });

    fixture.detectChanges();
    await settle();

    await component.regenerate();
    fixture.detectChanges();

    expect(snackServiceSpy.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GCF.MISC.LOCAL_REST_API_TOKEN_REGENERATE_ERROR,
    });
    // The still-valid token stays on screen.
    expect(component.token()).toBe('OLD_TOKEN');
    expect(tokenInputValue()).toBe('OLD_TOKEN');
    expect(component.isRegenerating()).toBe(false);
  });

  it('surfaces a failed initial load instead of rendering an empty field', async () => {
    // The main process throws here when it could not store the first token — it
    // then failed closed, so the API is switched on in settings and not running.
    // An empty field would read as "no token yet", which is not what happened.
    setEa({
      getLocalRestApiToken: jasmine.createSpy().and.rejectWith(new Error('ENOENT')),
    });

    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(component.hasTokenError()).toBe(true);
    expect(component.token()).toBeNull();
    const error = fixture.nativeElement.querySelector('.token-error');
    expect(error).toBeTruthy();
    // Inserted after the first render, so assistive technology only hears about
    // it if the element is a live region.
    expect(error.getAttribute('role')).toBe('alert');
  });

  it('does not claim the previous token is valid when there never was one', async () => {
    const regenerateLocalRestApiToken = jasmine
      .createSpy('regenerateLocalRestApiToken')
      .and.rejectWith(new Error('ENOSPC'));
    setEa({
      getLocalRestApiToken: jasmine.createSpy().and.rejectWith(new Error('ENOSPC')),
      regenerateLocalRestApiToken,
    });

    fixture.detectChanges();
    await settle();
    await component.regenerate();
    fixture.detectChanges();

    expect(snackServiceSpy.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GCF.MISC.LOCAL_REST_API_TOKEN_ERROR,
    });
    expect(snackServiceSpy.open).not.toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GCF.MISC.LOCAL_REST_API_TOKEN_REGENERATE_ERROR,
    });
    expect(component.hasTokenError()).toBe(true);
  });

  it('clears the error once a regeneration finally succeeds', async () => {
    const regenerateLocalRestApiToken = jasmine
      .createSpy('regenerateLocalRestApiToken')
      .and.resolveTo('RECOVERED_TOKEN');
    setEa({
      getLocalRestApiToken: jasmine.createSpy().and.rejectWith(new Error('ENOSPC')),
      regenerateLocalRestApiToken,
    });

    fixture.detectChanges();
    await settle();
    expect(component.hasTokenError()).toBe(true);

    await component.regenerate();
    fixture.detectChanges();

    expect(component.hasTokenError()).toBe(false);
    expect(tokenInputValue()).toBe('RECOVERED_TOKEN');
    expect(fixture.nativeElement.querySelector('.token-error')).toBeNull();
  });

  it('ignores a second regenerate while one is in flight', async () => {
    let resolveFirst!: (v: string) => void;
    const regenerateLocalRestApiToken = jasmine
      .createSpy('regenerateLocalRestApiToken')
      .and.callFake(
        () =>
          new Promise<string>((r) => {
            resolveFirst = r;
          }),
      );
    setEa({
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo(null),
      regenerateLocalRestApiToken,
    });
    fixture.detectChanges();

    const first = component.regenerate();
    await component.regenerate(); // must be a no-op while busy
    expect(regenerateLocalRestApiToken).toHaveBeenCalledTimes(1);
    expect(component.isRegenerating()).toBe(true);

    resolveFirst('NEW_TOKEN');
    await first;
    expect(component.isRegenerating()).toBe(false);
  });

  it('does not throw when the Electron bridge is unavailable', async () => {
    delete (window as unknown as { ea?: unknown }).ea;
    fixture.detectChanges();
    await settle();
    await component.regenerate();
    expect(component.token()).toBeNull();
  });

  it('does not read (and thereby mint) a token while the API is off', async () => {
    const getLocalRestApiToken = jasmine.createSpy('getLocalRestApiToken');
    setEa({
      getLocalRestApiState: jasmine
        .createSpy()
        .and.resolveTo({ isEnabled: false, isListening: false }),
      getLocalRestApiToken,
    });

    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(getLocalRestApiToken).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.token-value')).toBeNull();
  });

  it('switches the API on over IPC and then shows the token', async () => {
    const setLocalRestApiEnabled = jasmine
      .createSpy('setLocalRestApiEnabled')
      .and.resolveTo(ENABLED_STATE);
    setEa({
      getLocalRestApiState: jasmine
        .createSpy()
        .and.resolveTo({ isEnabled: false, isListening: false }),
      setLocalRestApiEnabled,
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo('TOKEN'),
    });
    fixture.detectChanges();
    await settle();

    await component.toggle(true);
    fixture.detectChanges();

    expect(setLocalRestApiEnabled).toHaveBeenCalledOnceWith(true);
    expect(component.isEnabled()).toBe(true);
    expect(tokenInputValue()).toBe('TOKEN');
  });

  it('shows why an enabled API is not running', async () => {
    setEa({
      getLocalRestApiState: jasmine.createSpy().and.resolveTo({
        isEnabled: true,
        isListening: false,
        error: 'PORT_IN_USE',
      }),
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo('TOKEN'),
    });

    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('.status');
    expect(status.classList).toContain('is-error');
    expect(status.textContent).toContain(T.GCF.MISC.LOCAL_REST_API_STATUS_PORT_IN_USE);
  });

  it('reports a toggle that could not be saved', async () => {
    setEa({
      getLocalRestApiState: jasmine
        .createSpy()
        .and.resolveTo({ isEnabled: false, isListening: false }),
      setLocalRestApiEnabled: jasmine.createSpy().and.rejectWith(new Error('EACCES')),
    });
    fixture.detectChanges();
    await settle();

    await component.toggle(true);

    expect(snackServiceSpy.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GCF.MISC.LOCAL_REST_API_TOGGLE_ERROR,
    });
    expect(component.isEnabled()).toBe(false);
    expect(component.isToggling()).toBe(false);
  });
});
