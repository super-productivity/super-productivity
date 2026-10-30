import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { PlainspaceReconnectNoticeComponent } from './plainspace-reconnect-notice.component';
import { PlainspaceConnectionStateService } from '../../issue/providers/plainspace/plainspace-connection-state.service';
import { PlainspaceConnectDialogComponent } from '../connect-dialog/plainspace-connect-dialog.component';
import { IssueProviderPlainspace } from '../../issue/issue.model';

describe('PlainspaceReconnectNoticeComponent', () => {
  let fixture: ComponentFixture<PlainspaceReconnectNoticeComponent>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let state: PlainspaceConnectionStateService;
  const provider = {
    id: 'ps-1',
    issueProviderKey: 'PLAINSPACE',
    host: 'https://plainspace.example',
    token: 'pat_old',
  } as IssueProviderPlainspace;

  beforeEach(async () => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    await TestBed.configureTestingModule({
      imports: [PlainspaceReconnectNoticeComponent, TranslateModule.forRoot()],
      providers: [{ provide: MatDialog, useValue: matDialog }],
    }).compileComponents();
    state = TestBed.inject(PlainspaceConnectionStateService);
    fixture = TestBed.createComponent(PlainspaceReconnectNoticeComponent);
    fixture.componentRef.setInput('issueProvider', provider);
    fixture.detectChanges();
  });

  const button = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('button');

  it('renders nothing while the token works', () => {
    expect(button()).toBeNull();
  });

  it('asks to reconnect after a 401 and passes the rejected token on', () => {
    state.reportError('ps-1', new HttpErrorResponse({ status: 401 }));
    fixture.detectChanges();
    button()!.click();
    expect(matDialog.open).toHaveBeenCalledWith(PlainspaceConnectDialogComponent, {
      data: { host: 'https://plainspace.example', replacedToken: 'pat_old' },
    });
  });

  it('says once that the server is too old for titles', () => {
    state.reportServerTooOld('ps-1');
    state.reportServerTooOld('ps-1');
    fixture.detectChanges();
    const callouts = fixture.nativeElement.querySelectorAll('.callout');
    expect(callouts.length).toBe(1);
    expect(callouts[0].textContent).toContain('PLAINSPACE.SYNC.SERVER_TOO_OLD');
    expect(button()).toBeNull();
  });
});
