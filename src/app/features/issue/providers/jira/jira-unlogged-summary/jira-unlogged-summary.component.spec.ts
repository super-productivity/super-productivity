import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JiraUnloggedSummaryComponent } from './jira-unlogged-summary.component';
import { JiraWorklogService } from '../jira-worklog.service';
import { Task } from '../../../../tasks/task.model';
import { GITHUB_TYPE, JIRA_TYPE } from '../../../issue.const';
import { provideTranslateService } from '@ngx-translate/core';

describe('JiraUnloggedSummaryComponent', () => {
  let component: JiraUnloggedSummaryComponent;
  let fixture: ComponentFixture<JiraUnloggedSummaryComponent>;

  const makeTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task1',
      title: 'Test Task',
      issueType: JIRA_TYPE,
      issueId: 'PROJ-1',
      issueProviderId: 'p1',
      timeSpent: 3600000,
      issueTimeLogged: 0,
      ...overrides,
    }) as Task;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JiraUnloggedSummaryComponent],
      providers: [
        provideTranslateService(),
        {
          provide: JiraWorklogService,
          useValue: jasmine.createSpyObj('JiraWorklogService', [
            'openWorklogDialogForTask',
          ]),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JiraUnloggedSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should show nothing when no tasks have unlogged time', () => {
    fixture.componentRef.setInput('flatTasks', [makeTask({ issueTimeLogged: 3600000 })]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });

  it('should show tasks with unlogged time', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 7200000, issueTimeLogged: 3600000 }),
      makeTask({ id: 'task2', issueType: GITHUB_TYPE }),
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(1);
  });

  it('should exclude tasks where timeSpent <= issueTimeLogged', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 0, issueTimeLogged: 0 }),
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });
});
