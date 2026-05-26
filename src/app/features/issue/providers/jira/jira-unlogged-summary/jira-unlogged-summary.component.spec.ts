import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JiraUnloggedSummaryComponent } from './jira-unlogged-summary.component';
import { JiraWorklogService } from '../jira-worklog.service';
import { Task } from '../../../../tasks/task.model';
import { JIRA_TYPE } from '../../../issue.const';

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
      timeLoggedToJira: 0,
      ...overrides,
    }) as Task;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JiraUnloggedSummaryComponent],
      providers: [
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
    fixture.componentRef.setInput('flatTasks', [makeTask({ timeLoggedToJira: 3600000 })]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });

  it('should show tasks with unlogged time', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 7200000, timeLoggedToJira: 3600000 }),
      makeTask({ id: 'task2', issueType: 'GITHUB' as any }),
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(1);
  });

  it('should exclude tasks where timeSpent <= timeLoggedToJira', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 0, timeLoggedToJira: 0 }),
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });
});
