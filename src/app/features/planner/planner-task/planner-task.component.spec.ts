import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal, WritableSignal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlannerTaskComponent } from './planner-task.component';
import { TaskService } from '../../tasks/task.service';
import { DEFAULT_TASK, TaskCopy } from '../../tasks/task.model';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RenderLinksPipe } from '../../../ui/pipes/render-links.pipe';
import { TranslatePipe } from '@ngx-translate/core';

const makeTask = (overrides: Partial<TaskCopy> = {}): TaskCopy =>
  ({
    ...DEFAULT_TASK,
    projectId: 'p1',
    id: 't1',
    parentId: null,
    ...overrides,
  }) as TaskCopy;

describe('PlannerTaskComponent', () => {
  let currentTaskId: WritableSignal<string | null>;

  const create = (
    task: TaskCopy,
  ): {
    fixture: ComponentFixture<PlannerTaskComponent>;
    component: PlannerTaskComponent;
  } => {
    const fixture = TestBed.createComponent(PlannerTaskComponent);
    fixture.componentRef.setInput('task', task);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

  beforeEach(() => {
    currentTaskId = signal<string | null>(null);
    const taskServiceMock = {
      ...jasmine.createSpyObj('TaskService', [
        'setSelectedId',
        'toggleDoneWithAnimation',
        'update',
      ]),
      currentTaskId,
      getByIdLive$: () => of(null),
    };

    TestBed.configureTestingModule({
      imports: [PlannerTaskComponent, TranslateModule.forRoot()],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: TaskService, useValue: taskServiceMock }],
    });

    // Isolate the component from its heavyweight child components (tag-list etc.)
    // so the spec exercises PlannerTaskComponent's OWN template bindings without
    // needing the full Store/service graph. Child elements become unknown tags
    // (ignored via NO_ERRORS_SCHEMA); the pipes used in the template are kept.
    TestBed.overrideComponent(PlannerTaskComponent, {
      set: {
        imports: [MsToStringPipe, RenderLinksPipe, TranslatePipe],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  });

  it('renders the template without throwing', () => {
    expect(() => create(makeTask({ title: 'plain title' }))).not.toThrow();
  });

  describe('titleHasLinks', () => {
    it('is false for a plain title', () => {
      const { component } = create(makeTask({ title: 'plain title' }));
      expect(component.titleHasLinks()).toBe(false);
    });

    it('is true for a title containing a URL', () => {
      const { component } = create(makeTask({ title: 'see https://example.com' }));
      expect(component.titleHasLinks()).toBe(true);
    });
  });

  describe('timeEstimate', () => {
    it('returns the raw estimate when the task has subTaskIds', () => {
      const { component } = create(
        makeTask({ timeEstimate: 5000, timeSpent: 2000, subTaskIds: ['s1'] }),
      );
      expect(component.timeEstimate()).toBe(5000);
    });
  });

  describe('isCurrent', () => {
    it('is true when the current task id equals the task id and reflects on the host', () => {
      currentTaskId.set('t1');
      const { fixture, component } = create(makeTask({ id: 't1' }));
      expect(component.isCurrent()).toBe(true);
      expect(fixture.debugElement.nativeElement.classList.contains('isCurrent')).toBe(
        true,
      );
    });

    it('flips to false when the current task id changes', () => {
      currentTaskId.set('t1');
      const { fixture, component } = create(makeTask({ id: 't1' }));
      expect(component.isCurrent()).toBe(true);

      currentTaskId.set('other');
      fixture.detectChanges();
      expect(component.isCurrent()).toBe(false);
      expect(fixture.debugElement.nativeElement.classList.contains('isCurrent')).toBe(
        false,
      );
    });
  });

  describe('isDone host class', () => {
    it('carries the isDone class when the task is done', () => {
      const { fixture } = create(makeTask({ isDone: true }));
      expect(fixture.debugElement.nativeElement.classList.contains('isDone')).toBe(true);
    });

    it('omits the isDone class when the task is not done', () => {
      const { fixture } = create(makeTask({ isDone: false }));
      expect(fixture.debugElement.nativeElement.classList.contains('isDone')).toBe(false);
    });
  });
});
