import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  flushMicrotasks,
} from '@angular/core/testing';
import { IssuePanelCalendarAgendaComponent } from './issue-panel-calendar-agenda.component';
import { IssueService } from '../../issue/issue.service';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { IssueProviderCalendar, SearchResultItem } from '../../issue/issue.model';
import { LS } from '../../../core/persistence/storage-keys.const';
import { saveToRealLs } from '../../../core/persistence/local-storage';

describe('IssuePanelCalendarAgendaComponent', () => {
  let fixture: ComponentFixture<IssuePanelCalendarAgendaComponent>;
  let component: IssuePanelCalendarAgendaComponent;
  let issueService: jasmine.SpyObj<IssueService>;

  const createProvider = (
    overrides: Partial<IssueProviderCalendar> = {},
  ): IssueProviderCalendar =>
    ({
      id: 'provider-1',
      isEnabled: true,
      issueProviderKey: 'ICAL',
      icalUrl: 'https://example.com/calendar.ics',
      isAutoImportForCurrentDay: false,
      checkUpdatesEvery: 600000,
      showBannerBeforeThreshold: 600000,
      ...overrides,
    }) as IssueProviderCalendar;

  const createAgendaItem = (id: string, title: string): SearchResultItem<'ICAL'> => ({
    title,
    issueType: 'ICAL',
    issueData: {
      id,
      calProviderId: 'provider-1',
      title,
      start: new Date('2025-01-15T10:00:00Z').getTime(),
      duration: 3600000,
      issueProviderKey: 'ICAL',
    },
  });

  beforeEach(async () => {
    localStorage.clear();
    issueService = jasmine.createSpyObj<IssueService>('IssueService', [
      'searchIssues',
      'addTaskFromIssue',
    ]);

    await TestBed.configureTestingModule({
      imports: [IssuePanelCalendarAgendaComponent],
      providers: [
        { provide: IssueService, useValue: issueService },
        { provide: DropListService, useValue: {} },
      ],
    })
      .overrideComponent(IssuePanelCalendarAgendaComponent, {
        set: { template: '' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(IssuePanelCalendarAgendaComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should reload agenda items when provider config changes', fakeAsync(() => {
    issueService.searchIssues.and.resolveTo([]);

    fixture.componentRef.setInput('issueProvider', createProvider());
    fixture.detectChanges();
    flushMicrotasks();

    expect(issueService.searchIssues).toHaveBeenCalledOnceWith(
      '',
      'provider-1',
      'ICAL',
      true,
    );

    fixture.componentRef.setInput(
      'issueProvider',
      createProvider({ filterExcludeRegex: 'Lunch' }),
    );
    fixture.detectChanges();
    flushMicrotasks();

    expect(issueService.searchIssues.calls.count()).toBe(2);
  }));

  it('should apply regex filters to cached fallback items', fakeAsync(() => {
    issueService.searchIssues.and.rejectWith(new Error('offline'));
    const cacheKey = 'calendar_agenda:provider-1';
    saveToRealLs(LS.ISSUE_SEARCH_CACHE, {
      [cacheKey]: [
        createAgendaItem('meeting-event', 'Team Meeting'),
        createAgendaItem('lunch-event', 'Lunch'),
      ],
    });

    fixture.componentRef.setInput(
      'issueProvider',
      createProvider({ filterExcludeRegex: 'Lunch' }),
    );
    fixture.detectChanges();
    flushMicrotasks();

    const titles = component
      .agendaItems()
      .flatMap((day) => day.itemsForDay.map((item) => item.title));

    expect(component.isShowingCachedData()).toBeTrue();
    expect(titles).toEqual(['Team Meeting']);
  }));
});
