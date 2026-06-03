import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { IssueProviderTabComponent } from './issue-provider-tab.component';
import { IssueService } from '../../issue/issue.service';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { IssueProvider } from '../../issue/issue.model';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

const createIssueProvider = (): IssueProvider =>
  ({
    id: 'ip1',
    isEnabled: true,
    issueProviderKey: 'GITHUB',
    defaultProjectId: null,
    pinnedSearch: null,
  }) as unknown as IssueProvider;

describe('IssueProviderTabComponent', () => {
  let fixture: ComponentFixture<IssueProviderTabComponent>;
  let component: IssueProviderTabComponent;
  let issueService: jasmine.SpyObj<IssueService>;
  let store: jasmine.SpyObj<Store>;

  beforeEach(async () => {
    issueService = jasmine.createSpyObj<IssueService>('IssueService', [
      'searchIssues',
      'addTaskFromIssue',
    ]);
    issueService.searchIssues.and.resolveTo([]);

    store = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    store.select.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [IssueProviderTabComponent, NoopAnimationsModule],
      providers: [
        DropListService,
        { provide: IssueService, useValue: issueService },
        { provide: Store, useValue: store },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IssueProviderTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('issueProvider', createIssueProvider());
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  describe('pinned search', () => {
    it('should debounce searchIssues calls by 400ms', fakeAsync(() => {
      component.searchText.set('test');
      fixture.detectChanges();
      tick(1);
      expect(issueService.searchIssues).not.toHaveBeenCalled();
      tick(400);

      expect(issueService.searchIssues).toHaveBeenCalledOnceWith('test', 'ip1', 'GITHUB');
    }));

    it('should not call searchIssues for empty search text', fakeAsync(() => {
      component.searchText.set('');
      fixture.detectChanges();
      tick(500);
      expect(issueService.searchIssues).not.toHaveBeenCalled();
    }));

    it('should only call searchIssues once for rapid changes, using final term', fakeAsync(() => {
      component.searchText.set('a');
      fixture.detectChanges();
      tick(100);
      component.searchText.set('ab');
      fixture.detectChanges();
      tick(100);
      component.searchText.set('abc');
      fixture.detectChanges();
      expect(issueService.searchIssues).not.toHaveBeenCalled();
      tick(399);
      expect(issueService.searchIssues).not.toHaveBeenCalled();
      tick(2);
      expect(issueService.searchIssues).toHaveBeenCalledOnceWith('abc', 'ip1', 'GITHUB');
    }));
  });
});
