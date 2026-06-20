import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { PlainspaceConnectDialogComponent } from './plainspace-connect-dialog.component';
import { PlainspaceAccountService } from '../plainspace-account.service';

describe('PlainspaceConnectDialogComponent', () => {
  let component: PlainspaceConnectDialogComponent;
  let fixture: ComponentFixture<PlainspaceConnectDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<PlainspaceConnectDialogComponent, boolean>>;
  let accountService: jasmine.SpyObj<PlainspaceAccountService>;

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    accountService = jasmine.createSpyObj('PlainspaceAccountService', ['connect']);

    await TestBed.configureTestingModule({
      imports: [
        PlainspaceConnectDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { host: 'https://plainspace.org' } },
        { provide: PlainspaceAccountService, useValue: accountService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlainspaceConnectDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders and uses the provided host', () => {
    expect(component).toBeTruthy();
    expect(component.host).toBe('https://plainspace.org');
  });

  it('does nothing when the token is blank', async () => {
    component.token = '   ';
    await component.connect();
    expect(accountService.connect).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('connects with the trimmed token and closes with true on success', async () => {
    accountService.connect.and.resolveTo(true);
    component.token = '  pat_abc  ';
    await component.connect();
    expect(accountService.connect).toHaveBeenCalledWith(
      'pat_abc',
      'https://plainspace.org',
    );
    expect(dialogRef.close).toHaveBeenCalledWith(true);
    expect(component.hasError()).toBe(false);
  });

  it('shows an error and stays open on an invalid token', async () => {
    accountService.connect.and.resolveTo(false);
    component.token = 'bad';
    await component.connect();
    expect(component.hasError()).toBe(true);
    expect(component.isConnecting()).toBe(false);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('cancel closes with false', () => {
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });
});
