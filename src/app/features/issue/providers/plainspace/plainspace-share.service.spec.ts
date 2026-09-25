import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { PlainspaceShareService } from './plainspace-share.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';
import { PlainspaceConnectDialogComponent } from '../../../plainspace/connect-dialog/plainspace-connect-dialog.component';
import { PlainspaceSpacePickerDialogComponent } from '../../../plainspace/space-picker-dialog/plainspace-space-picker-dialog.component';
import { LS } from '../../../../core/persistence/storage-keys.const';

describe('PlainspaceShareService', () => {
  let service: PlainspaceShareService;
  let account: PlainspaceAccountService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let api: jasmine.SpyObj<PlainspaceApiService>;
  let snack: jasmine.SpyObj<SnackService>;
  let store: jasmine.SpyObj<Store>;
  let onlineSpy: jasmine.Spy;

  // afterClosed() results, keyed by which dialog opened.
  let connectResult: unknown;
  let spaceResult: unknown;

  const openedConnectDialog = (): boolean =>
    matDialog.open.calls.allArgs().some((a) => a[0] === PlainspaceConnectDialogComponent);

  beforeEach(() => {
    localStorage.setItem(
      LS.PLAINSPACE_ACCOUNT,
      JSON.stringify({ host: 'https://plainspace.org', token: 'pat_x', email: 'e' }),
    );

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    connectResult = true;
    spaceResult = undefined;
    matDialog.open.and.callFake((comp: unknown) => {
      if (comp === PlainspaceConnectDialogComponent) {
        return { afterClosed: () => of(connectResult) } as ReturnType<MatDialog['open']>;
      }
      if (comp === PlainspaceSpacePickerDialogComponent) {
        return { afterClosed: () => of(spaceResult) } as ReturnType<MatDialog['open']>;
      }
      return { afterClosed: () => of(undefined) } as ReturnType<MatDialog['open']>;
    });

    api = jasmine.createSpyObj('PlainspaceApiService', ['createSpace$', 'getSpaceUrl$']);
    api.createSpace$.and.returnValue(of({ id: 'space-1' }));
    snack = jasmine.createSpyObj('SnackService', ['open']);
    store = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    store.select.and.returnValue(of(undefined));

    TestBed.configureTestingModule({
      providers: [
        PlainspaceShareService,
        PlainspaceAccountService,
        { provide: MatDialog, useValue: matDialog },
        { provide: PlainspaceApiService, useValue: api },
        { provide: SnackService, useValue: snack },
        { provide: Store, useValue: store },
      ],
    });
    service = TestBed.inject(PlainspaceShareService);
    account = TestBed.inject(PlainspaceAccountService);
    // Default to online; the offline test flips this. (The Karma runner reports
    // navigator.onLine === false, so we must spy it for the online path.)
    onlineSpy = spyOnProperty(navigator, 'onLine').and.returnValue(true);
  });

  afterEach(() => localStorage.removeItem(LS.PLAINSPACE_ACCOUNT));

  it('shows a calm offline message and does nothing when offline', async () => {
    onlineSpy.and.returnValue(false);

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(result).toBeNull();
    expect(snack.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.PLAINSPACE.OFFLINE,
    });
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('skips the connect dialog when already logged in', async () => {
    spaceResult = undefined; // user cancels the space picker

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(openedConnectDialog()).toBe(false);
    expect(result).toBeNull();
    // Cancelling the picker is not an error — no LOGIN_REQUIRED/OFFLINE snack.
    expect(snack.open).not.toHaveBeenCalled();
  });

  it('opens the connect dialog when there is no account, and reports cancel', async () => {
    account.logout();
    connectResult = false; // user backs out of connect

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(openedConnectDialog()).toBe(true);
    expect(result).toBeNull();
    expect(snack.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.PLAINSPACE.LOGIN_REQUIRED,
    });
  });

  it('prompts for connection again after disconnecting from the space picker', async () => {
    matDialog.open.and.callFake((comp: unknown) => {
      if (comp === PlainspaceSpacePickerDialogComponent) {
        account.logout();
      }
      return { afterClosed: () => of(undefined) } as ReturnType<MatDialog['open']>;
    });

    expect(await service.shareProjectOnPlainspace('p1', 'Proj')).toBeNull();
    expect(account.isLoggedIn()).toBe(false);
    expect(snack.open).not.toHaveBeenCalled();
    matDialog.open.calls.reset();

    expect(await service.shareProjectOnPlainspace('p1', 'Proj')).toBeNull();
    expect(openedConnectDialog()).toBe(true);
    expect(matDialog.open).toHaveBeenCalledTimes(1);
    expect(api.createSpace$).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('provisions a new space and registers a bound provider on success', async () => {
    spaceResult = { action: 'create' };

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(result).toBe('space-1');
    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        issueProvider: jasmine.objectContaining({
          defaultProjectId: 'p1',
          spaceId: 'space-1',
          token: 'pat_x',
        }),
      }),
    );
    expect(snack.open).toHaveBeenCalledWith({
      type: 'SUCCESS',
      msg: T.PLAINSPACE.SHARE_SUCCESS,
    });
  });

  it('binds the selected existing space without creating another one', async () => {
    spaceResult = { action: 'link', spaceId: 'selected-space' };

    expect(await service.shareProjectOnPlainspace('p1', 'Proj')).toBe('selected-space');
    expect(api.createSpace$).not.toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        issueProvider: jasmine.objectContaining({ spaceId: 'selected-space' }),
      }),
    );
  });

  it('shows a visible error and creates no provider when space creation fails', async () => {
    spaceResult = { action: 'create' };
    api.createSpace$.and.returnValue(throwError(() => new Error('API failure')));

    expect(await service.shareProjectOnPlainspace('p1', 'Proj')).toBeNull();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(snack.open).toHaveBeenCalledOnceWith({
      type: 'ERROR',
      msg: T.PLAINSPACE.SHARE_FAILED,
    });
  });

  describe('openProjectOnPlainspace', () => {
    const provider = {
      id: 'ip1',
      issueProviderKey: 'PLAINSPACE',
      host: 'https://plainspace.org',
      spaceId: 'space-1',
      token: 'pat_x',
    } as unknown;

    it('resolves the space URL and opens it in a new tab', async () => {
      store.select.and.returnValue(of(provider));
      api.getSpaceUrl$.and.returnValue(of('https://plainspace.org/my-slug'));
      const openSpy = spyOn(window, 'open');

      await service.openProjectOnPlainspace('p1');

      expect(api.getSpaceUrl$).toHaveBeenCalledWith(provider as never);
      expect(openSpy).toHaveBeenCalledWith(
        'https://plainspace.org/my-slug',
        '_blank',
        'noopener,noreferrer',
      );
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('does nothing when the project has no bound provider', async () => {
      store.select.and.returnValue(of(undefined));
      api.getSpaceUrl$.and.returnValue(of('x'));
      const openSpy = spyOn(window, 'open');

      await service.openProjectOnPlainspace('p1');

      expect(api.getSpaceUrl$).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('shows an error snack when the URL cannot be resolved', async () => {
      store.select.and.returnValue(of(provider));
      api.getSpaceUrl$.and.returnValue(of(null));
      const openSpy = spyOn(window, 'open');

      await service.openProjectOnPlainspace('p1');

      expect(openSpy).not.toHaveBeenCalled();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.OPEN_FAILED,
      });
    });
  });
});
