import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogJiraIssuePickerComponent } from './dialog-jira-issue-picker.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { JiraApiService } from '../jira-api.service';
import { IssueProviderService } from '../../../issue-provider.service';
import { of } from 'rxjs';

describe('DialogJiraIssuePickerComponent', () => {
  let component: DialogJiraIssuePickerComponent;
  let fixture: ComponentFixture<DialogJiraIssuePickerComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogJiraIssuePickerComponent>>;
  let mockJiraApiService: jasmine.SpyObj<JiraApiService>;
  let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockJiraApiService = jasmine.createSpyObj('JiraApiService', ['search$']);
    mockJiraApiService.search$.and.returnValue(of([]));
    mockIssueProviderService = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    mockIssueProviderService.getCfgOnce$.and.returnValue(of({} as any));

    await TestBed.configureTestingModule({
      imports: [
        DialogJiraIssuePickerComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      providers: [
        provideMockStore({
          initialState: {
            issueProvider: { ids: [], entities: {} },
          },
        }),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: JiraApiService, useValue: mockJiraApiService },
        { provide: IssueProviderService, useValue: mockIssueProviderService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogJiraIssuePickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should close dialog with result when select() is called', () => {
    (component as any).selectedProviderId.set('prov1');
    component.select({ id: '10001', key: 'PROJ-1', summary: 'Test issue' } as any);
    expect(mockDialogRef.close).toHaveBeenCalledWith({
      issueId: '10001',
      issueProviderId: 'prov1',
      issueKey: 'PROJ-1',
      issueSummary: 'Test issue',
    });
  });
});
