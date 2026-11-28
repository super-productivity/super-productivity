import { TestBed } from '@angular/core/testing';
import { T } from '../../t.const';
import { BehaviorSubject, of } from 'rxjs';
import { ProjectTaskPageComponent } from './project-task-page.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ProjectService } from '../../features/project/project.service';
import { PlainspaceClaimPoolService } from '../../features/plainspace/plainspace-claim-pool.service';
import {
  PlainspaceSharedTask,
  PlainspaceTeamOverview,
} from '../../features/plainspace/plainspace-shared-task.model';
import { DEFAULT_TASK, TaskWithSubTasks } from '../../features/tasks/task.model';

const task = (id: string, fields: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks => ({
  ...DEFAULT_TASK,
  id,
  projectId: 'project-1',
  subTasks: [],
  ...fields,
});

const linked = (id: string, fields: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
  task(id, {
    issueProviderId: 'provider-1',
    issueType: 'PLAINSPACE',
    issueId: `remote-${id}`,
    ...fields,
  });

const preview = (linkedTask: TaskWithSubTasks): PlainspaceSharedTask => ({
  id: linkedTask.issueId!,
  title: 'Remote task',
  isRecurring: false,
  isDone: false,
  assignee: { id: 'alice', displayName: 'Alice' },
});

describe('ProjectTaskPageComponent Plainspace task visibility', () => {
  let component: ProjectTaskPageComponent;
  let team$: BehaviorSubject<PlainspaceTeamOverview | null>;
  let backlog$: BehaviorSubject<TaskWithSubTasks[]>;
  let done$: BehaviorSubject<TaskWithSubTasks[]>;
  let undone$: BehaviorSubject<TaskWithSubTasks[]>;

  beforeEach(() => {
    team$ = new BehaviorSubject<PlainspaceTeamOverview | null>(null);
    backlog$ = new BehaviorSubject<TaskWithSubTasks[]>([]);
    done$ = new BehaviorSubject<TaskWithSubTasks[]>([]);
    undone$ = new BehaviorSubject<TaskWithSubTasks[]>([]);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContext$: of({}),
            backlogTasks$: backlog$,
            doneTasks$: done$,
            undoneTasks$: undone$,
          },
        },
        {
          provide: ProjectService,
          useValue: { currentProject$: of({ id: 'project-1' }) },
        },
        {
          provide: PlainspaceClaimPoolService,
          useValue: { teamOverviewForProject$: () => team$ },
        },
      ],
    }).overrideTemplate(ProjectTaskPageComponent, '');
    component = TestBed.createComponent(ProjectTaskPageComponent).componentInstance;
  });

  it('keeps personal project tasks as-is', () => {
    const tasks = [linked('old-link'), task('local')];
    undone$.next(tasks);
    expect(component.taskLists().undone).toBe(tasks);
    expect(component.taskLists().localSubtaskParents).toEqual([]);
  });

  it('keeps Only mine on a refresh and starts a different shared project on Everyone', () => {
    team$.next({ providerId: 'provider-1', status: 'loading', tasks: [] });
    component.onlyMine.set(true);
    team$.next({ providerId: 'provider-1', status: 'ready', tasks: [] });
    expect(component.onlyMine()).toBeTrue();
    team$.next({ providerId: 'provider-2', status: 'ready', tasks: [] });
    expect(component.onlyMine()).toBeFalse();
  });

  it('projects known foreign tasks from their exact provider and keeps their local children reachable', () => {
    const child = task('child', { parentId: 'backlog' });
    const foreignChild = linked('foreign-child', { parentId: 'backlog' });
    const foreignBacklog = linked('backlog', { subTasks: [child, foreignChild] });
    const foreignDone = linked('done', { isDone: true });
    const foreignUndone = linked('undone');
    const foreignNested = linked('foreign-nested', { parentId: 'local' });
    const native = task('local', { subTasks: [foreignNested] });
    const otherProvider = linked('other-provider', {
      issueProviderId: 'provider-2',
      issueId: foreignUndone.issueId,
    });
    const retained = [
      foreignBacklog,
      foreignDone,
      foreignUndone,
      foreignChild,
      foreignNested,
    ];
    const teammatePreview = preview(linked('teammate'));
    backlog$.next([foreignBacklog]);
    done$.next([foreignDone]);
    undone$.next([foreignUndone, otherProvider, native]);
    team$.next({
      providerId: 'provider-1',
      status: 'ready',
      tasks: [...retained.map(preview), teammatePreview],
    });

    expect(component.taskLists()).toEqual({
      backlog: [],
      done: [],
      undone: [otherProvider, native],
      previews: [
        ...retained.map((copy) => ({ ...preview(copy), localTaskId: copy.id })),
        teammatePreview,
      ],
      localSubtaskParents: [{ ...foreignBacklog, subTasks: [child] }],
    });
    expect(component.taskLists().undone[1]).toBe(native);
    expect(component.taskLists().undone[1].subTasks).toEqual([foreignNested]);
    expect(component.hideNativeTask(foreignNested)).toBeTrue();
    expect(foreignBacklog.subTasks).toEqual([child, foreignChild]);
  });

  it('labels the retained copy when a teammate completes their task and it leaves the open feed', () => {
    const retained = linked('handed-off');
    undone$.next([retained]);
    team$.next({
      providerId: 'provider-1',
      status: 'ready',
      tasks: [],
      assignedTaskIds: new Set(['my-task']),
    });
    expect(component.taskLists().undone).toEqual([retained]);
    expect(component.ownerLabel(retained.id, 'provider-1')).toBe(T.PLAINSPACE.LOCAL_COPY);
    expect(component.ownerLabel('my-task', 'provider-1')).toBe(T.PLAINSPACE.YOU);
    expect(component.ownerLabel('my-task', 'another-provider')).toBeUndefined();
    component.onlyMine.set(true);
    expect(component.taskLists().undone).toEqual([]);
  });

  it('shows only confirmed linked ownership during an outage while personal tasks remain usable', () => {
    const unknown = linked('unknown');
    const confirmed = linked('created');
    const personal = task('local');
    undone$.next([unknown, confirmed, personal]);
    team$.next({
      providerId: 'provider-1',
      status: 'unavailable',
      tasks: [],
      locallyAssignedTaskIds: new Set([confirmed.issueId!]),
    });
    expect(component.ownerLabel(unknown.issueId!, 'provider-1')).toBe(
      T.PLAINSPACE.LOCAL_COPY,
    );
    component.onlyMine.set(true);
    expect(component.taskLists().undone).toEqual([confirmed, personal]);
  });
});
