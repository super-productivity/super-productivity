import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AddTaskBarIssueSearchService } from './add-task-bar-issue-search.service';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TagService } from '../../tag/tag.service';
import { ProjectService } from '../../project/project.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { IssueService } from '../../issue/issue.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { selectMainTasksWithoutProject } from '../store/task.selectors';
import { SearchResultItem } from '../../issue/issue.model';
import { AddTaskSuggestion } from './add-task-suggestions.model';
import { Task } from '../task.model';

describe('AddTaskBarIssueSearchService', () => {
  let service: AddTaskBarIssueSearchService;
  let issueSearch$: Subject<SearchResultItem[]>;
  let backlogTasks$: BehaviorSubject<Task[]>;

  beforeEach(() => {
    issueSearch$ = new Subject<SearchResultItem[]>();
    backlogTasks$ = new BehaviorSubject<Task[]>([]);
    TestBed.configureTestingModule({
      providers: [
        AddTaskBarIssueSearchService,
        provideMockStore({
          selectors: [{ selector: selectMainTasksWithoutProject, value: [] }],
        }),
        { provide: TaskService, useValue: {} },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextTypeAndId$: of({
              activeType: WorkContextType.PROJECT,
              activeId: 'p1',
            }),
            backlogTasks$,
          },
        },
        { provide: TagService, useValue: {} },
        {
          provide: ProjectService,
          useValue: { getByIdOnce$: () => of({ id: 'p2', title: 'Other' }) },
        },
        { provide: GlobalConfigService, useValue: {} },
        { provide: SnackService, useValue: {} },
        {
          provide: IssueService,
          useValue: { searchAllEnabledIssueProviders$: () => issueSearch$ },
        },
      ],
    });
    service = TestBed.inject(AddTaskBarIssueSearchService);
  });

  it('should drop a slow search result once the input has changed', fakeAsync(() => {
    const input$ = new BehaviorSubject<string>('');
    const emissions: AddTaskSuggestion[][] = [];
    const sub = service
      .getFilteredIssueSuggestions$(input$, of(true), signal(false))
      .subscribe((s) => emissions.push(s));
    tick(300);
    emissions.length = 0;

    input$.next('old');
    tick(300); // search for "old" starts, issue providers still pending
    input$.next('old term'); // user keeps typing before it returns
    issueSearch$.next([]); // the stale "old" search now comes back empty

    expect(emissions).toEqual([]);
    sub.unsubscribe();
  }));

  it('should find tasks in the project backlog and in other projects', fakeAsync(() => {
    backlogTasks$.next([{ id: 'b1', title: 'Charlie backlog', projectId: 'p1' } as Task]);
    TestBed.inject(MockStore).overrideSelector(selectMainTasksWithoutProject, [
      { id: 'o1', title: 'Charlie other', projectId: 'p2' } as Task,
    ]);
    const emissions: AddTaskSuggestion[][] = [];
    const sub = service
      .getFilteredIssueSuggestions$(
        new BehaviorSubject('charlie'),
        of(true),
        signal(false),
      )
      .subscribe((s) => emissions.push(s));
    tick(300);
    issueSearch$.next([]);
    tick();

    expect(emissions[emissions.length - 1].map((s) => s.taskId)).toEqual(['b1', 'o1']);
    sub.unsubscribe();
  }));

  it('should match search text literally, not as a regex', fakeAsync(() => {
    backlogTasks$.next([{ id: 'b1', title: 'Fix C++ (build)', projectId: 'p1' } as Task]);
    const emissions: AddTaskSuggestion[][] = [];
    const sub = service
      .getFilteredIssueSuggestions$(new BehaviorSubject('c++ ('), of(true), signal(false))
      .subscribe((s) => emissions.push(s));
    tick(300);
    issueSearch$.next([]);
    tick();

    expect(emissions[emissions.length - 1].map((s) => s.taskId)).toEqual(['b1']);
    sub.unsubscribe();
  }));
});
