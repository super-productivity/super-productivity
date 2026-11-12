import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Store } from '@ngrx/store';
import { TaskMultiDragService } from './task-multi-drag.service';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskBulkActionService } from './task-bulk-action.service';
import { DEFAULT_TASK, Task } from './task.model';
import { Section } from '../section/section.model';
import { SectionService } from '../section/section.service';
import { selectAllSections } from '../section/store/section.selectors';
import { selectOverdueTasksWithSubTasks } from './store/task.selectors';
import { selectActiveWorkContext } from '../work-context/store/work-context.selectors';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { TODAY_TAG } from '../tag/tag.const';

describe('TaskMultiDragService', () => {
  let service: TaskMultiDragService;
  let selection: TaskMultiSelectService;
  let tasks: ReturnType<typeof signal<Record<string, Task>>>;
  let sections: ReturnType<typeof signal<Section[]>>;
  let sectionService: jasmine.SpyObj<SectionService>;
  let bulk: { moveToProject: jasmine.Spy };
  let dispatch: jasmine.Spy;
  let undone$: BehaviorSubject<Task[]>;
  let overdue: ReturnType<typeof signal<Task[]>>;
  let contextRowIds: ReturnType<typeof signal<string[]>>;
  let context: {
    activeWorkContextId: string;
    activeWorkContextType: WorkContextType;
    undoneTasks$: BehaviorSubject<Task[]>;
  };
  const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    projectId: 'p',
    title: id,
    ...overrides,
  });
  const section = (id: string, taskIds: string[]): Section => ({
    id,
    title: id,
    contextType: WorkContextType.PROJECT,
    contextId: 'p',
    taskIds,
    isExpanded: true,
  });
  beforeEach(() => {
    tasks = signal({ a: task('a'), b: task('b'), c: task('c') });
    sections = signal([section('left', ['a']), section('right', ['c'])]);
    sectionService = jasmine.createSpyObj('SectionService', [
      'addTaskToSection',
      'removeTaskFromSection',
    ]);
    bulk = { moveToProject: jasmine.createSpy('moveToProject').and.resolveTo() };
    dispatch = jasmine.createSpy('dispatch');
    undone$ = new BehaviorSubject([task('a'), task('b'), task('c')]);
    overdue = signal<Task[]>([]);
    contextRowIds = signal(['a', 'b', 'c']);
    context = {
      activeWorkContextId: 'p',
      activeWorkContextType: WorkContextType.PROJECT,
      undoneTasks$: undone$,
    };
    TestBed.configureTestingModule({
      providers: [
        TaskMultiDragService,
        TaskMultiSelectService,
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: (selector: unknown) =>
              selector === selectAllSections
                ? sections
                : selector === selectOverdueTasksWithSubTasks
                  ? overdue
                  : selector === selectActiveWorkContext
                    ? computed(() => ({ taskIds: contextRowIds() }))
                    : tasks,
          },
        },
        { provide: SectionService, useValue: sectionService },
        { provide: TaskBulkActionService, useValue: bulk },
        { provide: WorkContextService, useValue: context },
        {
          provide: DateService,
          useValue: {
            todayStr: () => '2026-11-09',
            getStartOfNextDayDiffMs: () => 0,
          },
        },
      ],
    });
    service = TestBed.inject(TaskMultiDragService);
    selection = TestBed.inject(TaskMultiSelectService);
    spyOn(selection, 'selectedIdsInDomOrder').and.callFake(() =>
      [...selection.selectedIds()].reverse(),
    );
  });
  const start = (): void => {
    selection.toggle('a');
    selection.toggle('b');
    service.start(tasks()['a']);
  };
  it('snapshots selected parents in visual order', () => {
    tasks.update((value) => ({ ...value, child: task('child', { parentId: 'a' }) }));
    selection.toggle('child');
    start();
    expect(service.ids()).toEqual(['b', 'a']);
    expect(service.selectionSize()).toBe(2);
  });
  it('previews all dragged parents in snapshot order and clears their visual state', () => {
    start();
    expect(service.previewTasks().map((item) => item.id)).toEqual(['b', 'a']);
    expect(service.draggedIds()).toEqual(new Set(['b', 'a']));
    service.clear();
    expect(service.draggedIds().size).toBe(0);
  });
  it('does not group an unselected drag or a subtask drag', () => {
    start();
    service.start(tasks()['c']);
    expect(service.ids()).toEqual([]);
    service.start(task('child', { parentId: 'a' }));
    expect(service.ids()).toEqual([]);
  });
  it('groups list drags in project and tag views, but not planner drags', () => {
    start();
    expect(service.isListGroupDrag()).toBeTrue();
    context.activeWorkContextType = WorkContextType.TAG;
    service.start(tasks()['a']);
    expect(service.isListGroupDrag()).toBeTrue();
    service.start(tasks()['b'], 'PLANNER');
    expect(service.ids()).toEqual(['b', 'a']);
    expect(service.isListGroupDrag()).toBeFalse();
    expect(service.canDrop('PARENT', 'UNDONE')).toBeFalse();
  });
  it('carries selected subtasks only in a planner group', () => {
    tasks.update((value) => ({ ...value, child: task('child', { parentId: 'c' }) }));
    selection.toggle('child');
    selection.toggle('a');
    service.start(tasks()['child'], 'PLANNER');
    expect(service.ids()).toEqual(['a', 'child']);
    expect(service.plannerPreviewTasks().map((item) => item.id)).toEqual(['a', 'child']);
    expect(service.previewTasks().map((item) => item.id)).toEqual(['a']);
  });
  it('keeps touch selection on its existing menu path', () => {
    selection.enterTouchSelectionMode('a');
    selection.toggle('b');
    service.start(tasks()['a']);
    expect(service.ids()).toEqual([]);
  });
  it('rejects unsupported targets and cross-project selections', () => {
    start();
    expect(service.canDrop('PARENT', 'right')).toBeTrue();
    expect(service.canDrop('PARENT', 'UNDONE')).toBeTrue();
    for (const target of ['BACKLOG', 'DONE', 'OVERDUE', 'missing'])
      expect(service.canDrop('PARENT', target)).toBeFalse();
    expect(service.canDrop('SUB', 'right')).toBeFalse();
    expect(service.canDrop('PARENT', 'right', 'tag')).toBeFalse();
    // Lists inside the grouped work view pass `null` for non-tag groups.
    expect(service.canDrop('PARENT', 'UNDONE', null)).toBeFalse();
    // Not in the open context's undone list (another project, Later Today, backlog).
    undone$.next([task('a'), task('c')]);
    expect(service.canDrop('PARENT', 'right')).toBeFalse();
  });
  it('chains anchors across explicit sources when dropping into a section', async () => {
    start();
    await service.drop('right', 'a', ['c', 'a']);
    expect(sectionService.addTaskToSection.calls.allArgs()).toEqual([
      ['right', 'b', 'c', null],
      ['right', 'a', 'b', 'left'],
    ]);
    expect(selection.isBulkFeedbackSuppressed()).toBeFalse();
  });
  it('removes selected rows from the destination anchor when reordering a group', async () => {
    start();
    await service.drop('right', 'a', ['b', 'a', 'c']);
    expect(sectionService.addTaskToSection.calls.allArgs()).toEqual([
      ['right', 'b', null, null],
      ['right', 'a', 'b', 'left'],
    ]);
  });

  it('moves a cross-section selection into the leader section when the leader keeps its slot', async () => {
    sections.set([section('left', ['a']), section('right', ['b', 'c'])]);
    selection.toggle('b');
    selection.toggle('a');
    service.start(tasks()['b']);
    expect(service.ids()).toEqual(['a', 'b']);
    expect(service.isPlacementUnchanged('b', ['b', 'c'])).toBeFalse();

    await service.drop('right', 'b', ['b', 'c']);

    expect(sectionService.addTaskToSection.calls.allArgs()).toEqual([
      ['right', 'a', null, 'left'],
      ['right', 'b', 'a', 'right'],
    ]);
  });

  it('recognizes only an unchanged whole-group placement as a no-op', () => {
    sections.set([section('right', ['a', 'b', 'c'])]);
    selection.toggle('b');
    selection.toggle('a');
    service.start(tasks()['b']);
    expect(service.ids()).toEqual(['a', 'b']);

    expect(service.isPlacementUnchanged('b', ['a', 'b', 'c'])).toBeTrue();
    expect(service.isPlacementUnchanged('b', ['a', 'c', 'b'])).toBeFalse();
  });
  it('recognizes an unchanged group after an unselected anchor for either dragged member', () => {
    sections.set([section('right', ['c', 'a', 'b'])]);
    selection.toggle('b');
    selection.toggle('a');
    service.start(tasks()['a']);

    expect(service.isPlacementUnchanged('a', ['c', 'a', 'b'])).toBeTrue();
    expect(service.isPlacementUnchanged('b', ['c', 'a', 'b'])).toBeTrue();
  });

  it('groups separated selected tasks at the stationary leader slot', async () => {
    sections.set([section('right', ['a', 'c', 'b'])]);
    selection.toggle('b');
    selection.toggle('a');
    service.start(tasks()['a']);
    expect(service.isPlacementUnchanged('a', ['a', 'c', 'b'])).toBeFalse();

    await service.drop('right', 'a', ['a', 'c', 'b']);

    expect(sectionService.addTaskToSection.calls.allArgs()).toEqual([
      ['right', 'a', null, 'right'],
      ['right', 'b', 'a', 'right'],
    ]);
  });
  it('returns sectioned tasks and root tasks to the exact root slot', async () => {
    start();
    await service.drop('UNDONE', 'a', ['c', 'a', 'b']);
    expect(dispatch.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ taskId: 'b', afterTaskId: 'c', workContextId: 'p' }),
    );
    expect(sectionService.removeTaskFromSection).toHaveBeenCalledWith(
      'left',
      'a',
      'p',
      WorkContextType.PROJECT,
      'b',
    );
  });
  it('rejects tasks deleted or completed during a drag', async () => {
    start();
    tasks.set({ a: task('a') });
    await service.drop('right', 'a', ['a']);
    expect(sectionService.addTaskToSection).not.toHaveBeenCalled();
  });
  it('cancels without falling back to moving one task', async () => {
    start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(service.isCancelled()).toBeTrue();
    await service.drop('right', 'a', ['a']);
    expect(sectionService.addTaskToSection).not.toHaveBeenCalled();
    service.clear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(service.isCancelled()).toBeFalse();
  });
  it('keeps the snapshot until CDK has emitted its drop callback', async () => {
    start();
    service.finish();
    expect(service.ids()).toEqual(['b', 'a']);
    const placement = service.drop('right', 'a', ['a']);
    expect(sectionService.addTaskToSection).toHaveBeenCalledTimes(2);
    await placement;
    expect(service.ids()).toEqual([]);
  });
  it('does not clear a newer drag during deferred cleanup', async () => {
    start();
    service.finish();
    service.start(tasks()['a']);
    await Promise.resolve();
    expect(service.ids()).toEqual(['b', 'a']);
  });
  it('rejects tasks completed during the gesture', () => {
    start();
    tasks.update((value) => ({ ...value, b: task('b', { isDone: true }) }));
    expect(service.canDrop('PARENT', 'right')).toBeFalse();
  });
  it('uses a captured snapshot after the drag has ended for project drops', async () => {
    start();
    const ids = [...service.ids()];
    service.clear();
    await service.moveToProject('other', ids);
    expect(bulk.moveToProject).toHaveBeenCalledWith('other', ['b', 'a']);
  });

  describe('in Today', () => {
    beforeEach(() => {
      context.activeWorkContextId = TODAY_TAG.id;
      context.activeWorkContextType = WorkContextType.TAG;
      sections.set([
        {
          ...section('focus', ['c']),
          contextType: WorkContextType.TAG,
          contextId: TODAY_TAG.id,
        },
      ]);
    });

    it('reorders the group in the Today list after the drop anchor', async () => {
      start();
      await service.drop('UNDONE', 'a', ['c', 'a']);
      expect(dispatch.calls.allArgs().map(([action]) => action)).toEqual([
        jasmine.objectContaining({
          taskId: 'b',
          afterTaskId: 'c',
          src: 'UNDONE',
          workContextId: TODAY_TAG.id,
          workContextType: WorkContextType.TAG,
        }),
        jasmine.objectContaining({ taskId: 'a', afterTaskId: 'b' }),
      ]);
    });

    it('only accepts Today sections, not another context with the same id', () => {
      start();
      expect(service.canDrop('PARENT', 'focus')).toBeTrue();
      sections.set([section('focus', ['c'])]);
      expect(service.canDrop('PARENT', 'focus')).toBeFalse();
    });

    it('plans overdue members for today once, then places every member', async () => {
      undone$.next([task('a'), task('c')]);
      overdue.set([task('b')]);
      start();
      expect(service.canDrop('PARENT', 'UNDONE')).toBeTrue();

      await service.drop('UNDONE', 'a', ['a', 'c']);

      const actions = dispatch.calls.allArgs().map(([action]) => action);
      expect(actions[0]).toEqual(
        TaskSharedActions.planTasksForToday({
          taskIds: ['b'],
          today: '2026-11-09',
          startOfNextDayDiffMs: 0,
        }),
      );
      expect(actions.slice(1)).toEqual([
        jasmine.objectContaining({ taskId: 'b', afterTaskId: null, src: 'OVERDUE' }),
        jasmine.objectContaining({ taskId: 'a', afterTaskId: 'b', src: 'UNDONE' }),
      ]);
    });

    it('admits overdue members only in Today', () => {
      undone$.next([task('a'), task('c')]);
      overdue.set([task('b')]);
      context.activeWorkContextId = 'some-tag';
      start();
      expect(service.canDrop('PARENT', 'UNDONE')).toBeFalse();
    });

    describe('with a subtask listed on its own (parent not due today)', () => {
      beforeEach(() => {
        tasks.update((value) => ({ ...value, s: task('s', { parentId: 'x' }) }));
        contextRowIds.set(['a', 'b', 's']);
        undone$.next([task('a'), task('b'), task('s', { parentId: 'x' })]);
        selection.toggle('a');
        selection.toggle('b');
        selection.toggle('s');
      });

      it('moves the subtask row with the group, whichever row leads', async () => {
        service.start(tasks()['a']);
        expect(service.ids()).toEqual(['s', 'b', 'a']);
        expect(service.selectionSize()).toBe(3);
        expect(service.previewTasks().map((item) => item.id)).toEqual(['s', 'b', 'a']);
        expect(service.canDrop('PARENT', 'UNDONE')).toBeTrue();

        await service.drop('UNDONE', 'a', ['c', 'a']);
        expect(dispatch.calls.allArgs().map(([action]) => action.taskId)).toEqual([
          's',
          'b',
          'a',
        ]);

        service.start(tasks()['s']);
        expect(service.ids()).toEqual(['s', 'b', 'a']);
      });

      it('includes an overdue subtask row', () => {
        contextRowIds.set(['a', 'b']);
        undone$.next([task('a'), task('b')]);
        overdue.set([task('s', { parentId: 'x' })]);
        service.start(tasks()['s']);
        expect(service.ids()).toEqual(['s', 'b', 'a']);
        expect(service.canDrop('PARENT', 'UNDONE')).toBeTrue();
      });
    });

    it('stops watching the undone list when the drag is cleared', () => {
      start();
      expect(undone$.observed).toBeTrue();
      service.clear();
      expect(undone$.observed).toBeFalse();
    });
  });
});
