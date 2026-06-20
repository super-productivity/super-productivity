import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlainspaceSpacePickerDialogComponent } from './plainspace-space-picker-dialog.component';
import { PlainspaceAccountService } from '../plainspace-account.service';
import { PlainspaceApiService } from '../../issue/providers/plainspace/plainspace-api.service';

const SPACES = [
  { id: 's1', name: 'Space One', slug: 'one' },
  { id: 's2', name: 'Space Two', slug: 'two' },
];
const ACCOUNT = { host: 'https://plainspace.org', token: 'pat_abc', email: 'a@b.c' };

describe('PlainspaceSpacePickerDialogComponent', () => {
  let component: PlainspaceSpacePickerDialogComponent;
  let fixture: ComponentFixture<PlainspaceSpacePickerDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<PlainspaceSpacePickerDialogComponent>>;
  let accountStub: { account: jasmine.Spy };
  let apiStub: { getSpaces$: jasmine.Spy };

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    accountStub = { account: jasmine.createSpy('account').and.returnValue(ACCOUNT) };
    apiStub = { getSpaces$: jasmine.createSpy('getSpaces$').and.returnValue(of(SPACES)) };

    await TestBed.configureTestingModule({
      imports: [
        PlainspaceSpacePickerDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: PlainspaceAccountService, useValue: accountStub },
        { provide: PlainspaceApiService, useValue: apiStub },
      ],
    }).compileComponents();
  });

  const createComponent = (): void => {
    fixture = TestBed.createComponent(PlainspaceSpacePickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('loads the spaces and preselects the first', async () => {
    createComponent();
    await fixture.whenStable();
    expect(apiStub.getSpaces$).toHaveBeenCalled();
    expect(component.spaces()).toEqual(SPACES);
    expect(component.selectedSpaceId).toBe('s1');
    expect(component.isLoading()).toBe(false);
  });

  it('link() closes with the selected existing space', async () => {
    createComponent();
    await fixture.whenStable();
    component.selectedSpaceId = 's2';
    component.link();
    expect(dialogRef.close).toHaveBeenCalledWith({ action: 'link', spaceId: 's2' });
  });

  it('link() does nothing without a selection', async () => {
    apiStub.getSpaces$.and.returnValue(of([]));
    createComponent();
    await fixture.whenStable();
    component.selectedSpaceId = null;
    component.link();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('createNew() closes with the create action', () => {
    createComponent();
    component.createNew();
    expect(dialogRef.close).toHaveBeenCalledWith({ action: 'create' });
  });

  it('cancel() closes with no result', () => {
    createComponent();
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });

  it('shows the error state (not empty) when the spaces request fails', async () => {
    apiStub.getSpaces$.and.returnValue(of(null));
    createComponent();
    await fixture.whenStable();
    expect(component.hasError()).toBe(true);
    expect(component.isLoading()).toBe(false);
    expect(component.spaces()).toEqual([]);
  });

  it('closes immediately when no account is connected', async () => {
    accountStub.account.and.returnValue(null);
    createComponent();
    await fixture.whenStable();
    expect(apiStub.getSpaces$).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
