import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { IssueService } from '../issue/issue.service';
import { LocalRestApiFeatureBridgeService } from './local-rest-api-feature-bridge.service';
import { addSubTask } from './store/task.actions';
import { Task } from './task.model';
import { TaskService } from './task.service';

describe('LocalRestApiFeatureBridgeService', () => {
  let service: LocalRestApiFeatureBridgeService;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let issueServiceMock: jasmine.SpyObj<IssueService>;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    taskServiceMock = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
    ]);
    issueServiceMock = jasmine.createSpyObj<IssueService>('IssueService', ['issueLink']);

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiFeatureBridgeService,
        { provide: TaskService, useValue: taskServiceMock },
        { provide: IssueService, useValue: issueServiceMock },
        provideMockStore(),
      ],
    });

    service = TestBed.inject(LocalRestApiFeatureBridgeService);
    dispatchSpy = spyOn(TestBed.inject(MockStore), 'dispatch');
  });

  it('should delegate issueLink to the issue service', async () => {
    issueServiceMock.issueLink.and.returnValue(
      Promise.resolve('https://github.com/o/r/issues/42'),
    );

    await expectAsync(service.issueLink('GITHUB', '42', 'provider-1')).toBeResolvedTo(
      'https://github.com/o/r/issues/42',
    );
    expect(issueServiceMock.issueLink).toHaveBeenCalledOnceWith(
      'GITHUB',
      '42',
      'provider-1',
    );
  });

  it('should add a subtask that skips short syntax', () => {
    taskServiceMock.createNewTaskWithDefaults.and.returnValue({
      id: 'literal-sub',
      title: 'Child #x',
    } as Task);

    const id = service.addLiteralSubTask('parent-1', { title: 'Child #x' });

    expect(id).toBe('literal-sub');
    // Same arguments TaskService.addSubTaskTo passes — incl. the dueDay key,
    // whose presence stops a Today context from giving the subtask a due date.
    const factoryArgs = taskServiceMock.createNewTaskWithDefaults.calls.mostRecent()
      .args[0] as { title: string; additional: Record<string, unknown> };
    expect(factoryArgs.title).toBe('Child #x');
    expect('dueDay' in factoryArgs.additional).toBe(true);
    expect(factoryArgs.additional.title).toBe('Child #x');
    const action = dispatchSpy.calls.mostRecent().args[0];
    expect(action.type).toBe(addSubTask.type);
    expect(action.task.id).toBe('literal-sub');
    expect(action.parentId).toBe('parent-1');
    expect(action.isIgnoreShortSyntax).toBe(true);
  });
});
