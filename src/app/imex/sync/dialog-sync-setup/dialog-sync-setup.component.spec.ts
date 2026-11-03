import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SyncLog } from '../../../core/log';
import { T } from '../../../t.const';
import {
  ConnectRequest,
  ConnectUnsupportedError,
  SignInOutcome,
} from '../super-sync-connect/super-sync-connect.api';
import {
  normalizeSuperSyncBaseUrl,
  SuperSyncConnectService,
} from '../super-sync-connect/super-sync-connect.service';
import { DialogSyncCfgComponent } from '../dialog-sync-cfg/dialog-sync-cfg.component';
import { DialogSyncSetupComponent } from './dialog-sync-setup.component';

const BASE = 'https://sync.example.com';
const REQUEST: ConnectRequest = {
  requestId: 'a'.repeat(22),
  pollSecret: 's'.repeat(43),
  matchCode: 'ABC-DEF',
  pollIntervalMs: 3000,
};

describe('DialogSyncSetupComponent', () => {
  let fixture: ComponentFixture<DialogSyncSetupComponent>;
  let component: DialogSyncSetupComponent;
  let connect: jasmine.SpyObj<SuperSyncConnectService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogSyncSetupComponent>>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  // The pending wait: the test decides when and how the browser answers.
  let answer: (outcome: SignInOutcome) => void;
  let isCancelled: () => boolean;

  const text = (): string => fixture.nativeElement.textContent;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    connect = jasmine.createSpyObj('SuperSyncConnectService', [
      'savedBaseUrl',
      'start',
      'waitForApproval',
      'openBlankTab',
      'openInBrowser',
      'returnToApp',
      'applyToken',
    ]);
    connect.savedBaseUrl.and.resolveTo(BASE);
    connect.start.and.resolveTo(REQUEST);
    connect.openBlankTab.and.returnValue(null);
    connect.applyToken.and.resolveTo();
    connect.waitForApproval.and.callFake((_url, _req, cancelled) => {
      isCancelled = cancelled;
      return new Promise((resolve) => (answer = resolve));
    });
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    spyOn(SyncLog, 'warn');

    await TestBed.configureTestingModule({
      imports: [
        DialogSyncSetupComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: SuperSyncConnectService, useValue: connect },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: matDialog },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DialogSyncSetupComponent);
    component = fixture.componentInstance;
    await settle();
  });

  it('starts at the saved server', () => {
    expect(component.baseUrl()).toBe(BASE);
    expect(component.host()).toBe('sync.example.com');
  });

  it('names the server under the button only when it is not the default', async () => {
    const serverName = (): string =>
      fixture.nativeElement.querySelector('.e2e-sign-in-server-name')?.textContent ?? '';
    // BASE is not this build's default server.
    expect(serverName()).toContain(T.F.SYNC.D_SIGN_IN.SERVER);

    connect.savedBaseUrl.and.resolveTo(normalizeSuperSyncBaseUrl('')!);
    fixture = TestBed.createComponent(DialogSyncSetupComponent);
    await settle();
    expect(serverName()).toBe('');
  });

  it('keeps Sign in focusable while the saved server loads, and ignores a click until then', async () => {
    // The dialog focuses its first enabled button on open; a disabled Sign in
    // hands that focus to the other-providers button.
    connect.savedBaseUrl.and.returnValue(new Promise(() => {}));
    fixture = TestBed.createComponent(DialogSyncSetupComponent);
    await settle();
    const signIn: HTMLButtonElement = fixture.nativeElement.querySelector('.e2e-sign-in');
    expect(signIn.disabled).toBe(false);

    signIn.click();
    await settle();
    expect(connect.start).not.toHaveBeenCalled();
  });

  it('opens the browser at the request and shows the match code', async () => {
    const tab = {} as Window;
    connect.openBlankTab.and.returnValue(tab);
    void component.signIn();
    await settle();
    expect(connect.start).toHaveBeenCalledWith(BASE);
    expect(connect.openInBrowser).toHaveBeenCalledWith(
      `${BASE}/?r=${REQUEST.requestId}`,
      tab,
    );
    expect(component.step()).toBe('waiting');
    expect(text()).toContain('ABC-DEF');
  });

  it('saves the token and closes once the browser approves', async () => {
    const done = component.signIn();
    await settle();
    answer({ kind: 'approved', token: 'jwt' });
    await done;
    expect(connect.returnToApp).toHaveBeenCalled();
    expect(connect.applyToken).toHaveBeenCalledWith('jwt', BASE);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  for (const kind of ['denied', 'expired'] as const) {
    it(`shows the timed-out step when the request is ${kind}`, async () => {
      const done = component.signIn();
      await settle();
      answer({ kind });
      await done;
      expect(component.step()).toBe('timed-out');
      expect(connect.applyToken).not.toHaveBeenCalled();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.e2e-sign-in-try-again')).toBeTruthy();
    });
  }

  it('ends the wait on Cancel and on closing the dialog', async () => {
    void component.signIn();
    await settle();
    component.cancelWaiting();
    expect(isCancelled()).toBe(true);
    expect(component.step()).toBe('choose');

    void component.signIn();
    await settle();
    expect(isCancelled()).toBe(false);
    fixture.destroy();
    expect(isCancelled()).toBe(true);
  });

  it('falls back to manual setup on a server without browser sign-in', async () => {
    const tab = jasmine.createSpyObj<Window>('Window', ['close']);
    connect.openBlankTab.and.returnValue(tab);
    connect.start.and.rejectWith(new ConnectUnsupportedError('HTTP 404'));
    await component.signIn();
    expect(tab.close).toHaveBeenCalled();
    expect(component.step()).toBe('manual');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.e2e-sign-in-access-token')).toBeTruthy();

    component.accessToken = '  pasted-token ';
    await component.saveAccessToken();
    expect(connect.applyToken).toHaveBeenCalledWith('pasted-token', BASE);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('stays on the first step with an error when the server is unreachable', async () => {
    connect.start.and.rejectWith(new TypeError('Failed to fetch'));
    await component.signIn();
    expect(component.step()).toBe('choose');
    expect(component.errorKey()).toBe(T.F.SYNC.D_SIGN_IN.START_FAILED);
    expect(connect.waitForApproval).not.toHaveBeenCalled();
  });

  it('signs in to a changed server, and refuses an invalid address', async () => {
    component.editServer();
    component.serverInput = 'not a server';
    await component.signIn();
    expect(component.errorKey()).toBe(T.F.SYNC.D_SIGN_IN.INVALID_SERVER);
    expect(connect.start).not.toHaveBeenCalled();

    component.serverInput = 'https://own.example.com/';
    void component.signIn();
    await settle();
    expect(connect.start).toHaveBeenCalledWith('https://own.example.com');
    expect(component.host()).toBe('own.example.com');
  });

  it('leads to the settings for other providers', async () => {
    await component.openOtherOptions();
    expect(dialogRef.close).toHaveBeenCalled();
    expect(matDialog.open).toHaveBeenCalledWith(DialogSyncCfgComponent);
  });
});
