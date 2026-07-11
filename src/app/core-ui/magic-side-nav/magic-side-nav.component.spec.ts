import { of } from 'rxjs';
import { TaskWithSubTasks } from '../../features/tasks/task.model';
import { createTask } from '../../features/tasks/task.test-helper';
import { MagicSideNavComponent } from './magic-side-nav.component';

// _handlePointerUp reaches into a large DI graph (Router, LayoutService,
// MagicNavConfigService, DataInitStateService, ...) that the full component
// doesn't need for this logic. Mirrors the DailySummaryComponent spec pattern:
// patch only the private fields the method under test touches, then invoke it
// directly, instead of paying for a full TestBed render of the nav tree.
const callHandlePointerUp = (receiver: MagicSideNavComponent, event: MouseEvent): void =>
  (
    MagicSideNavComponent.prototype as unknown as {
      _handlePointerUp: (event: MouseEvent) => void;
    }
  )._handlePointerUp.call(receiver, event);

const buildReceiver = (
  activeTask: TaskWithSubTasks | null,
): {
  receiver: MagicSideNavComponent;
  moveTaskToProjectWithRepeatCfgAwareness$: jasmine.Spy;
  addToToday: jasmine.Spy;
  updateTags: jasmine.Spy;
  setCancelNextDrop: jasmine.Spy;
  setActiveTask: jasmine.Spy;
} => {
  const moveTaskToProjectWithRepeatCfgAwareness$ = jasmine
    .createSpy('moveTaskToProjectWithRepeatCfgAwareness$')
    .and.returnValue(of('moved'));
  const addToToday = jasmine.createSpy('addToToday');
  const updateTags = jasmine.createSpy('updateTags');
  const setCancelNextDrop = jasmine.createSpy('setCancelNextDrop');
  const setActiveTask = jasmine.createSpy('setActiveTask');

  const receiver = Object.assign(Object.create(MagicSideNavComponent.prototype), {
    _taskService: {
      moveTaskToProjectWithRepeatCfgAwareness$,
      addToToday,
      updateTags,
    },
    _externalDragService: {
      activeTask: () => activeTask,
      activeDragRef: () => ({ ended: of(undefined) }),
      setCancelNextDrop,
      setActiveTask,
    },
  }) as MagicSideNavComponent;

  return {
    receiver,
    moveTaskToProjectWithRepeatCfgAwareness$,
    addToToday,
    updateTags,
    setCancelNextDrop,
    setActiveTask,
  };
};

// getPointerPosition() just reads clientX/clientY off a MouseEvent.
const pointerUpEvent = (): MouseEvent => ({ clientX: 5, clientY: 5 }) as MouseEvent;

// Mounts a detached <nav-item> so document.elementFromPoint(...).closest('nav-item')
// resolves to it, same technique as TaskListComponent's enterPredicate specs.
const withNavItem = (attrName: string, attrValue: string, run: () => void): void => {
  const navItem = document.createElement('nav-item');
  navItem.setAttribute(attrName, attrValue);
  document.body.appendChild(navItem);
  spyOn(document, 'elementFromPoint').and.returnValue(navItem);
  try {
    run();
  } finally {
    navItem.remove();
  }
};

describe('MagicSideNavComponent._handlePointerUp', () => {
  describe('dropping on a project', () => {
    it('moves a recurring task to the project (#8739)', () => {
      const task = createTask({
        id: 't1',
        dueWithTime: Date.now(),
        repeatCfgId: 'repeat-1',
      }) as unknown as TaskWithSubTasks;
      const { receiver, moveTaskToProjectWithRepeatCfgAwareness$, setCancelNextDrop } =
        buildReceiver(task);

      withNavItem('data-project-id', 'project-1', () => {
        callHandlePointerUp(receiver, pointerUpEvent());
      });

      expect(setCancelNextDrop).toHaveBeenCalledWith(true);
      expect(moveTaskToProjectWithRepeatCfgAwareness$).toHaveBeenCalledWith(
        task,
        'project-1',
      );
    });

    it('moves a non-recurring task to the project', () => {
      const task = createTask({ id: 't2' }) as unknown as TaskWithSubTasks;
      const { receiver, moveTaskToProjectWithRepeatCfgAwareness$ } = buildReceiver(task);

      withNavItem('data-project-id', 'project-1', () => {
        callHandlePointerUp(receiver, pointerUpEvent());
      });

      expect(moveTaskToProjectWithRepeatCfgAwareness$).toHaveBeenCalledWith(
        task,
        'project-1',
      );
    });

    it('does not move a subtask dropped on a project', () => {
      const task = createTask({
        id: 'sub1',
        parentId: 'parent1',
      }) as unknown as TaskWithSubTasks;
      const { receiver, moveTaskToProjectWithRepeatCfgAwareness$ } = buildReceiver(task);

      withNavItem('data-project-id', 'project-1', () => {
        callHandlePointerUp(receiver, pointerUpEvent());
      });

      expect(moveTaskToProjectWithRepeatCfgAwareness$).not.toHaveBeenCalled();
    });
  });

  describe('dropping on a tag', () => {
    it('does not move/tag a recurring task (due-date reschedule conflicts with its repeat)', () => {
      const task = createTask({
        id: 't1',
        repeatCfgId: 'repeat-1',
        tagIds: [],
      }) as unknown as TaskWithSubTasks;
      const { receiver, addToToday, updateTags } = buildReceiver(task);

      withNavItem('data-tag-id', 'tag-1', () => {
        callHandlePointerUp(receiver, pointerUpEvent());
      });

      expect(addToToday).not.toHaveBeenCalled();
      expect(updateTags).not.toHaveBeenCalled();
    });

    it('adds the tag to a non-recurring task', () => {
      const task = createTask({
        id: 't2',
        tagIds: [],
      }) as unknown as TaskWithSubTasks;
      const { receiver, updateTags } = buildReceiver(task);

      withNavItem('data-tag-id', 'tag-1', () => {
        callHandlePointerUp(receiver, pointerUpEvent());
      });

      expect(updateTags).toHaveBeenCalledWith(task, ['tag-1']);
    });
  });

  it('does nothing when there is no active dragged task', () => {
    const { receiver, moveTaskToProjectWithRepeatCfgAwareness$, addToToday, updateTags } =
      buildReceiver(null);

    withNavItem('data-project-id', 'project-1', () => {
      callHandlePointerUp(receiver, pointerUpEvent());
    });

    expect(moveTaskToProjectWithRepeatCfgAwareness$).not.toHaveBeenCalled();
    expect(addToToday).not.toHaveBeenCalled();
    expect(updateTags).not.toHaveBeenCalled();
  });
});
