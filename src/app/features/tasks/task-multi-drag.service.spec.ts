import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Store } from '@ngrx/store';
import { TaskMultiDragService } from './task-multi-drag.service';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskBulkActionService } from './task-bulk-action.service';
import { DEFAULT_TASK, Task } from './task.model';
import { DEFAULT_PROJECT } from '../project/project.const';
import { Section } from '../section/section.model';
import { SectionService } from '../section/section.service';
import { selectAllSections } from '../section/store/section.selectors';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';

describe('TaskMultiDragService', () => {
  let service: TaskMultiDragService;
  let selection: TaskMultiSelectService;
  let tasks: ReturnType<typeof signal<Record<string, Task>>>;
  let sections: ReturnType<typeof signal<Section[]>>;
  let sectionService: jasmine.SpyObj<SectionService>;
  let bulk: { moveToProject: jasmine.Spy };
  let dispatch: jasmine.Spy;
  let isProjectContext$: BehaviorSubject<boolean>;
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
    isProjectContext$ = new BehaviorSubject(true);
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
                : selector === selectProjectFeatureState
                  ? signal({
                      ids: ['p'],
                      entities: {
                        p: { ...DEFAULT_PROJECT, id: 'p', taskIds: ['a', 'b', 'c'] },
                      },
                    })
                  : tasks,
          },
        },
        { provide: SectionService, useValue: sectionService },
        { provide: TaskBulkActionService, useValue: bulk },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextId: 'p',
            activeWorkContextType: WorkContextType.PROJECT,
            isActiveWorkContextProject$: isProjectContext$,
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
  it('drags a selected task on its own outside project views', () => {
    isProjectContext$.next(false);
    start();
    expect(service.ids()).toEqual([]);
    expect(service.isGroupDragAvailable()).toBeFalse();
    isProjectContext$.next(true);
    expect(service.isGroupDragAvailable()).toBeTrue();
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
    tasks.update((value) => ({ ...value, b: task('b', { projectId: 'other' }) }));
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
});
