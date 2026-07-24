import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyLocalRestApiTokenComponent } from './formly-local-rest-api-token.component';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

describe('FormlyLocalRestApiTokenComponent', () => {
  let fixture: ComponentFixture<FormlyLocalRestApiTokenComponent>;
  let component: FormlyLocalRestApiTokenComponent;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;

  const tokenInputValue = (): string | undefined =>
    fixture.nativeElement.querySelector('.token-value')?.value;

  beforeEach(async () => {
    snackServiceSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        FormlyLocalRestApiTokenComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: SnackService, useValue: snackServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyLocalRestApiTokenComponent);
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
    (window as unknown as { ea: unknown }).ea = { getLocalRestApiToken };

    fixture.detectChanges(); // ngOnInit
    await fixture.whenStable();
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
    (window as unknown as { ea: unknown }).ea = {
      getLocalRestApiToken,
      regenerateLocalRestApiToken,
    };

    fixture.detectChanges();
    await fixture.whenStable();

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
    (window as unknown as { ea: unknown }).ea = {
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo('OLD_TOKEN'),
      regenerateLocalRestApiToken,
    };

    fixture.detectChanges();
    await fixture.whenStable();

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
    (window as unknown as { ea: unknown }).ea = {
      getLocalRestApiToken: jasmine.createSpy().and.resolveTo(null),
      regenerateLocalRestApiToken,
    };
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
    await fixture.whenStable();
    await component.regenerate();
    expect(component.token()).toBeNull();
  });
});
