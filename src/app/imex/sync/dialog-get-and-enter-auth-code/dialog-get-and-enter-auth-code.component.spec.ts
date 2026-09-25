import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { DialogGetAndEnterAuthCodeComponent } from './dialog-get-and-enter-auth-code.component';
import { OAuthCallbackHandlerService } from '../oauth-callback-handler.service';
import { SnackService } from '../../../core/snack/snack.service';

describe('DialogGetAndEnterAuthCodeComponent', () => {
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogGetAndEnterAuthCodeComponent>>;
  let component: DialogGetAndEnterAuthCodeComponent;

  beforeEach(() => {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { providerName: 'OneDrive', url: '' } },
        {
          provide: OAuthCallbackHandlerService,
          useValue: { authCodeReceived$: new Subject() },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    component = TestBed.runInInjectionContext(
      () => new DialogGetAndEnterAuthCodeComponent(),
    );
  });

  // #9546: a code copied from the address bar is still URL-encoded; sending
  // `%24` instead of `$` made Entra reject it with AADSTS70000.
  it('URL-decodes a bare pasted auth code', () => {
    component.close('  M.C5_BAY.2.U.abc%24%24  ');

    expect(dialogRefSpy.close).toHaveBeenCalledWith('M.C5_BAY.2.U.abc$$');
  });

  it('keeps a bare auth code that is not valid percent-encoding unchanged', () => {
    component.close('abc%E0%A4%A');

    expect(dialogRefSpy.close).toHaveBeenCalledWith('abc%E0%A4%A');
  });
});
