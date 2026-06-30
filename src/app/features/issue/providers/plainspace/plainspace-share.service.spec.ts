import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { PlainspaceShareService } from './plainspace-share.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';
import { PlainspaceConnectDialogComponent } from '../../../plainspace/connect-dialog/plainspace-connect-dialog.component';
import { PlainspaceSpacePickerDialogComponent } from '../../../plainspace/space-picker-dialog/plainspace-space-picker-dialog.component';

describe('PlainspaceShareService', () => {
  let service: PlainspaceShareService;
  let account: {
    isLoggedIn: jasmine.Spy;
    account: jasmine.Spy;
  };
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
    account = {
      isLoggedIn: jasmine.createSpy('isLoggedIn').and.returnValue(true),
      account: jasmine
        .createSpy('account')
        .and.returnValue({ host: 'https://plainspace.org', token: 'pat_x', email: 'e' }),
    };

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

    api = jasmine.createSpyObj('PlainspaceApiService', ['createSpace$']);
    api.createSpace$.and.returnValue(of({ id: 'space-1' }));
    snack = jasmine.createSpyObj('SnackService', ['open']);
    store = jasmine.createSpyObj('Store', ['dispatch']);

    TestBed.configureTestingModule({
      providers: [
        PlainspaceShareService,
        { provide: PlainspaceAccountService, useValue: account },
        { provide: MatDialog, useValue: matDialog },
        { provide: PlainspaceApiService, useValue: api },
        { provide: SnackService, useValue: snack },
        { provide: Store, useValue: store },
      ],
    });
    service = TestBed.inject(PlainspaceShareService);
    // Default to online; the offline test flips this. (The Karma runner reports
    // navigator.onLine === false, so we must spy it for the online path.)
    onlineSpy = spyOnProperty(navigator, 'onLine').and.returnValue(true);
  });

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
    account.isLoggedIn.and.returnValue(true);
    spaceResult = undefined; // user cancels the space picker

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(openedConnectDialog()).toBe(false);
    expect(result).toBeNull();
    // Cancelling the picker is not an error — no LOGIN_REQUIRED/OFFLINE snack.
    expect(snack.open).not.toHaveBeenCalled();
  });

  it('opens the connect dialog when there is no account, and reports cancel', async () => {
    account.isLoggedIn.and.returnValue(false);
    connectResult = false; // user backs out of connect

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(openedConnectDialog()).toBe(true);
    expect(result).toBeNull();
    expect(snack.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.PLAINSPACE.LOGIN_REQUIRED,
    });
  });

  it('provisions a new space and registers a bound provider on success', async () => {
    account.isLoggedIn.and.returnValue(true);
    spaceResult = { action: 'create' };

    const result = await service.shareProjectOnPlainspace('p1', 'Proj');

    expect(result).toBe('space-1');
    expect(store.dispatch).toHaveBeenCalled();
    expect(snack.open).toHaveBeenCalledWith({
      type: 'SUCCESS',
      msg: T.PLAINSPACE.SHARE_SUCCESS,
    });
  });
});
