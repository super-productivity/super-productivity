import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
  PlainspaceConnectDialogComponent,
  PlainspaceConnectDialogData,
  PlainspaceConnectDialogResult,
} from './plainspace-connect-dialog.component';
import { PlainspaceAccountService } from '../plainspace-account.service';
import { PlainspaceAuthApiService } from '../plainspace-auth-api.service';
import { T } from '../../../t.const';

describe('PlainspaceConnectDialogComponent', () => {
  const HOST = 'https://plainspace.org';
  let component: PlainspaceConnectDialogComponent;
  let fixture: ComponentFixture<PlainspaceConnectDialogComponent>;
  let dialogRef: jasmine.SpyObj<
    MatDialogRef<PlainspaceConnectDialogComponent, PlainspaceConnectDialogResult | false>
  >;
  let accountService: jasmine.SpyObj<PlainspaceAccountService>;
  let authApi: jasmine.SpyObj<PlainspaceAuthApiService>;

  const setup = async (
    data: PlainspaceConnectDialogData = { host: HOST },
  ): Promise<void> => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    accountService = jasmine.createSpyObj('PlainspaceAccountService', [
      'connect',
      'findAccountTokens',
    ]);
    authApi = jasmine.createSpyObj('PlainspaceAuthApiService', [
      'requestCode$',
      'connect$',
      'createSpace$',
      'createApiToken$',
    ]);

    await TestBed.configureTestingModule({
      imports: [
        PlainspaceConnectDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: PlainspaceAccountService, useValue: accountService },
        { provide: PlainspaceAuthApiService, useValue: authApi },
      ],
    }).compileComponents();

    accountService.findAccountTokens.and.resolveTo([]);

    fixture = TestBed.createComponent(PlainspaceConnectDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  /** Email sent, code typed: the dialog is on the code step. */
  const toCodeStep = async (): Promise<void> => {
    authApi.requestCode$.and.returnValue(of({ status: 'sent' as const }));
    component.email = ' me@example.com ';
    await component.requestCode();
    component.code = '123456';
  };

  afterEach(() => fixture.destroy());

  describe('email and code', () => {
    beforeEach(() => setup());

    it('starts on the email step with the host consent links', () => {
      expect(component.step()).toBe('email');
      expect(component.legalParams).toEqual({
        termsUrl: `${HOST}/terms`,
        privacyUrl: `${HOST}/privacy`,
      });
    });

    it('requests a code for the trimmed email and moves to the code step', async () => {
      await toCodeStep();
      expect(authApi.requestCode$).toHaveBeenCalledWith(HOST, 'me@example.com');
      expect(component.step()).toBe('code');
      expect(component.sentTo()).toBe('me@example.com');
      expect(component.resendIn()).toBeGreaterThan(0);
    });

    it('falls back to the browser when the host has no email-code connect', async () => {
      authApi.requestCode$.and.returnValue(of({ status: 'unsupported' as const }));
      component.email = 'me@example.com';
      await component.requestCode();
      expect(component.step()).toBe('browser');
      expect(component.isBrowserFallback()).toBe(true);
    });

    it('names the wait when too many codes were requested', async () => {
      authApi.requestCode$.and.returnValue(of({ status: 'rate-limited' as const }));
      component.email = 'me@example.com';
      await component.requestCode();
      expect(component.step()).toBe('email');
      expect(component.error()).toEqual({
        key: T.PLAINSPACE.CONNECT.RATE_LIMITED,
        params: { minutes: 2 },
      });
    });

    it('connects a returning account and closes with true', async () => {
      await toCodeStep();
      authApi.connect$.and.returnValue(
        of({ status: 'connected' as const, token: 'pat_new' }),
      );
      accountService.connect.and.resolveTo('ok');
      await component.submitCode();
      expect(authApi.connect$).toHaveBeenCalledWith(
        HOST,
        'me@example.com',
        '123456',
        false,
      );
      expect(accountService.findAccountTokens).not.toHaveBeenCalled();
      expect(accountService.connect).toHaveBeenCalledWith('pat_new', HOST, undefined, []);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('does not send a code that is not 6 digits', async () => {
      await toCodeStep();
      component.code = '12345';
      await component.submitCode();
      expect(authApi.connect$).not.toHaveBeenCalled();
    });

    it('stays on the code step on a wrong code', async () => {
      await toCodeStep();
      authApi.connect$.and.returnValue(of({ status: 'invalid-code' as const }));
      await component.submitCode();
      expect(component.step()).toBe('code');
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.INVALID_CODE);
      expect(component.isBusy()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('names the wait when there were too many attempts', async () => {
      await toCodeStep();
      authApi.connect$.and.returnValue(of({ status: 'rate-limited' as const }));
      await component.submitCode();
      expect(component.error()).toEqual({
        key: T.PLAINSPACE.CONNECT.RATE_LIMITED,
        params: { minutes: 15 },
      });
    });
  });

  describe('a key active elsewhere', () => {
    beforeEach(async () => {
      await setup({ host: HOST, replacedToken: 'pat_rejected' });
      await toCodeStep();
      authApi.connect$.and.returnValue(
        of({
          status: 'already-connected' as const,
          createdAt: '2026-10-01T00:00:00.000Z',
          lastUsedAt: null,
        }),
      );
      await component.submitCode();
    });

    it('asks before replacing it', () => {
      expect(component.step()).toBe('replace');
      expect(component.existingToken()).toBeNull();
      expect(authApi.connect$).toHaveBeenCalledTimes(1);
      expect(accountService.connect).not.toHaveBeenCalled();
    });

    it('finds the old key before forcing, and hands its providers the new one', async () => {
      // Looked up while the old key still answers, before the forced connect.
      let connectCallsAtLookup = -1;
      accountService.findAccountTokens.and.callFake(async () => {
        connectCallsAtLookup = authApi.connect$.calls.count();
        return ['pat_old'];
      });
      authApi.connect$.and.returnValue(
        of({ status: 'connected' as const, token: 'pat_new' }),
      );
      accountService.connect.and.resolveTo('ok');
      await component.replaceKey();
      expect(connectCallsAtLookup).toBe(1);
      expect(accountService.findAccountTokens).toHaveBeenCalledWith(
        HOST,
        'me@example.com',
      );
      expect(authApi.connect$).toHaveBeenCalledWith(
        HOST,
        'me@example.com',
        '123456',
        true,
      );
      expect(accountService.connect).toHaveBeenCalledWith(
        'pat_new',
        HOST,
        'pat_rejected',
        ['pat_old'],
      );
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('goes back to the code step when the held code expired', async () => {
      accountService.findAccountTokens.and.resolveTo([]);
      authApi.connect$.and.returnValue(of({ status: 'invalid-code' as const }));
      await component.replaceKey();
      expect(component.step()).toBe('code');
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.INVALID_CODE);
    });
  });

  // Another device's synced providers hold the account's working key, but this
  // device has no saved account: using that key revokes nothing.
  describe('a working key already on this device', () => {
    beforeEach(async () => {
      await setup();
      accountService.findAccountTokens.and.resolveTo(['pat_working']);
      await toCodeStep();
      authApi.connect$.and.returnValue(
        of({ status: 'already-connected' as const, createdAt: null, lastUsedAt: null }),
      );
      await component.submitCode();
    });

    it('offers it next to replacing', () => {
      expect(accountService.findAccountTokens).toHaveBeenCalledWith(
        HOST,
        'me@example.com',
      );
      expect(component.step()).toBe('replace');
      expect(component.existingToken()).toBe('pat_working');
    });

    it('connects with it without forcing a new key', async () => {
      accountService.connect.and.resolveTo('ok');
      await component.useExistingKey();
      expect(accountService.connect).toHaveBeenCalledWith('pat_working', HOST, undefined);
      expect(authApi.connect$).toHaveBeenCalledTimes(1);
      expect(authApi.connect$.calls.mostRecent().args[3]).toBe(false);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });
  });

  // Minting revoked the old key and consumed the code, so a failed check must
  // not drop the new key.
  describe('a minted key whose check fails', () => {
    beforeEach(async () => {
      await setup();
      await toCodeStep();
      authApi.connect$.and.returnValue(
        of({ status: 'connected' as const, token: 'pat_new' }),
      );
    });

    it('retries the check once on no answer', async () => {
      accountService.connect.and.returnValues(
        Promise.resolve('unreachable'),
        Promise.resolve('ok'),
      );
      await component.submitCode();
      expect(accountService.connect).toHaveBeenCalledTimes(2);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('keeps the key for Retry when the check keeps failing', async () => {
      accountService.connect.and.returnValues(
        Promise.resolve('unreachable'),
        Promise.resolve('aborted'),
        Promise.resolve('ok'),
      );
      await component.submitCode();
      expect(component.step()).toBe('retry');
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.UNREACHABLE);
      expect(dialogRef.close).not.toHaveBeenCalled();
      // Escape, backdrop and Android back can't drop the key meanwhile, and
      // there is no Cancel button.
      expect(dialogRef.disableClose).toBe(true);
      fixture.detectChanges();
      const actions: HTMLElement =
        fixture.nativeElement.querySelector('mat-dialog-actions');
      expect(actions.querySelectorAll('button').length).toBe(1);

      await component.retryStore();
      expect(accountService.connect).toHaveBeenCalledTimes(3);
      expect(accountService.connect.calls.mostRecent().args).toEqual([
        'pat_new',
        HOST,
        undefined,
        [],
      ]);
      // No new key was minted for the retry.
      expect(authApi.connect$).toHaveBeenCalledTimes(1);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
      expect(dialogRef.disableClose).toBe(false);
    });
  });

  describe('a new account', () => {
    const created = { id: 'space-1', slug: 'garden', memberToken: 'member_tok' };

    const toNameStep = async (): Promise<void> => {
      await toCodeStep();
      authApi.connect$.and.returnValue(of({ status: 'no-account' as const }));
      await component.submitCode();
      authApi.createSpace$.and.returnValue(
        of({ status: 'created' as const, space: created }),
      );
      component.displayName = ' Ann ';
    };

    it('creates the first Space named after the shared project', async () => {
      await setup({ host: HOST, spaceName: 'Garden' });
      await toNameStep();
      expect(component.step()).toBe('name');
      authApi.createApiToken$.and.returnValue(of('pat_new'));
      accountService.connect.and.resolveTo('ok');
      await component.createAccount();
      expect(authApi.createSpace$).toHaveBeenCalledWith(HOST, {
        name: 'Garden',
        displayName: 'Ann',
        email: 'me@example.com',
        code: '123456',
      });
      expect(authApi.createApiToken$).toHaveBeenCalledWith(HOST, created);
      expect(accountService.connect).toHaveBeenCalledWith('pat_new', HOST, undefined, []);
      expect(dialogRef.close).toHaveBeenCalledWith({ createdSpaceId: 'space-1' });
    });

    it('names it after the user when nothing is being shared', async () => {
      await setup();
      await toNameStep();
      authApi.createApiToken$.and.returnValue(of('pat_new'));
      accountService.connect.and.resolveTo('ok');
      await component.createAccount();
      expect(authApi.createSpace$.calls.mostRecent().args[1].name).toBe(
        "Ann's Plainspace",
      );
    });

    it('sends the user to the browser when the key cannot be minted', async () => {
      await setup();
      await toNameStep();
      authApi.createApiToken$.and.returnValue(of(null));
      await component.createAccount();
      expect(component.step()).toBe('browser');
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.KEY_FAILED);
      expect(accountService.connect).not.toHaveBeenCalled();
    });
  });

  describe('browser step', () => {
    beforeEach(async () => {
      await setup();
      component.useBrowser();
    });

    it('does nothing when the token is blank', async () => {
      component.token = '   ';
      await component.connect();
      expect(accountService.connect).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('connects with the trimmed token and closes with true on success', async () => {
      accountService.connect.and.resolveTo('ok');
      component.token = '  pat_abc  ';
      await component.connect();
      expect(accountService.connect).toHaveBeenCalledWith('pat_abc', HOST, undefined);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
      expect(component.errorMsg()).toBeNull();
    });

    it('shows the rejected-token message and stays open on an invalid token', async () => {
      accountService.connect.and.resolveTo('invalid-token');
      component.token = 'bad';
      await component.connect();
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.INVALID);
      expect(component.isBusy()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    // #9988: a request that never reached Plainspace must not be blamed on the
    // token — that is what sent users into an endless re-copy loop.
    it('shows the unreachable message when the host could not be reached', async () => {
      accountService.connect.and.resolveTo('unreachable');
      component.token = 'pat_abc';
      await component.connect();
      expect(component.errorMsg()).toBe(T.PLAINSPACE.CONNECT.UNREACHABLE);
      expect(component.isBusy()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('stays silent when the attempt was aborted by a disconnect', async () => {
      accountService.connect.and.resolveTo('aborted');
      component.token = 'pat_abc';
      await component.connect();
      expect(component.errorMsg()).toBeNull();
      expect(component.isBusy()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  it('cancel closes with false', async () => {
    await setup();
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });
});
