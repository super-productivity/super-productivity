import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { RestoreArchivedTaskService } from './restore-archived-task.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectTaskEntities } from './store/task.selectors';
import { DEFAULT_TASK, Task, TaskArchive } from './task.model';
import { T } from '../../t.const';

const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  id,
  title: `title ${id}`,
  projectId: 'project',
  ...partial,
});

describe('RestoreArchivedTaskService', () => {
  let service: RestoreArchivedTaskService;
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let taskArchiveService: jasmine.SpyObj<TaskArchiveService>;

  const makeArchive = (tasks: Task[]): TaskArchive => ({
    ids: tasks.map((t) => t.id),
    entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
  });
  const setConfirmResult = (result: boolean | undefined): void => {
    matDialog.open.and.returnValue({
      afterClosed: () => of(result),
    } as ReturnType<MatDialog['open']>);
  };

  beforeEach(() => {
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    taskArchiveService = jasmine.createSpyObj<TaskArchiveService>('TaskArchiveService', [
      'load',
    ]);
    const dateService = jasmine.createSpyObj<DateService>('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateService.todayStr.and.returnValue('2026-01-05');
    dateService.getStartOfNextDayDiffMs.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ selectors: [{ selector: selectTaskEntities, value: {} }] }),
        { provide: MatDialog, useValue: matDialog },
        { provide: TaskArchiveService, useValue: taskArchiveService },
        { provide: DateService, useValue: dateService },
      ],
    });
    service = TestBed.inject(RestoreArchivedTaskService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  describe('findRestorableTask', () => {
    it('returns the archived task itself for a top-level task', () => {
      const archived = createTask('a');
      const archive = makeArchive([archived]);

      expect(service.findRestorableTask(createTask('a'), archive)).toBe(archived);
    });

    it('returns the archived parent for a sub task', () => {
      const parent = createTask('parent', { subTaskIds: ['sub'] });
      const sub = createTask('sub', { parentId: 'parent' });
      const archive = makeArchive([parent, sub]);

      expect(service.findRestorableTask(sub, archive)).toBe(parent);
    });

    it('returns null for a task that is not in the archive', () => {
      const archive = makeArchive([]);

      expect(service.findRestorableTask(createTask('a'), archive)).toBeNull();
    });

    it('returns null for a sub task whose parent is not in the archive', () => {
      const sub = createTask('sub', { parentId: 'parent' });
      const archive = makeArchive([sub]);

      expect(service.findRestorableTask(sub, archive)).toBeNull();
    });

    it('returns null when the task is already active', () => {
      const task = createTask('a');
      const archive = makeArchive([task]);
      store.overrideSelector(selectTaskEntities, { a: task });
      store.refreshState();

      expect(service.findRestorableTask(task, archive)).toBeNull();
    });
  });

  describe('confirmAndRestore', () => {
    it('asks for confirmation naming the task', async () => {
      setConfirmResult(false);

      await service.confirmAndRestore(createTask('a', { title: 'Write report' }));

      expect(matDialog.open.calls.mostRecent().args[1]?.data).toEqual({
        okTxt: T.G.DO_IT,
        message: T.F.WORKLOG.D_CONFIRM_RESTORE,
        translateParams: { title: 'Write report' },
      });
    });

    it('writes nothing when the confirmation is declined', async () => {
      setConfirmResult(false);

      expect(await service.confirmAndRestore(createTask('a'))).toBe(false);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('writes nothing when the confirmation is dismissed', async () => {
      setConfirmResult(undefined);

      expect(await service.confirmAndRestore(createTask('a'))).toBe(false);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('dispatches one restoreTask for today with the archived sub tasks', async () => {
      const sub1 = createTask('sub1', { parentId: 'parent' });
      const sub2 = createTask('sub2', { parentId: 'parent' });
      // 'gone' is listed on the parent but missing from the archive
      const parent = createTask('parent', { subTaskIds: ['sub1', 'gone', 'sub2'] });
      taskArchiveService.load.and.resolveTo(makeArchive([parent, sub1, sub2]));
      setConfirmResult(true);

      expect(await service.confirmAndRestore(parent)).toBe(true);

      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.restoreTask({
          task: parent,
          subTasks: [sub1, sub2],
          restoreToToday: { today: '2026-01-05', startOfNextDayDiffMs: 0 },
        }),
      );
    });

    it('uses the current archived task when its details changed during confirmation', async () => {
      const displayed = createTask('a');
      const task = { ...displayed, notes: 'Updated since opening details' };
      taskArchiveService.load.and.resolveTo(makeArchive([task]));
      setConfirmResult(true);

      expect(await service.confirmAndRestore(displayed)).toBe(true);
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.restoreTask({
          task,
          subTasks: [],
          restoreToToday: { today: '2026-01-05', startOfNextDayDiffMs: 0 },
        }),
      );
    });

    it('opens an already restored task without dispatching another restore', async () => {
      const task = createTask('a');
      taskArchiveService.load.and.resolveTo(makeArchive([task]));
      store.overrideSelector(selectTaskEntities, { a: task });
      store.refreshState();
      setConfirmResult(true);

      expect(await service.confirmAndRestore(task)).toBe(true);
      expect(taskArchiveService.load).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('rechecks the active task after the archive read', async () => {
      const task = createTask('a');
      taskArchiveService.load.and.callFake(async () => {
        store.overrideSelector(selectTaskEntities, { a: task });
        store.refreshState();
        return makeArchive([task]);
      });
      setConfirmResult(true);

      expect(await service.confirmAndRestore(task)).toBe(true);
      expect(taskArchiveService.load).toHaveBeenCalledTimes(1);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('writes nothing when the confirmed task has left the archive', async () => {
      taskArchiveService.load.and.resolveTo(makeArchive([]));
      setConfirmResult(true);

      expect(await service.confirmAndRestore(createTask('gone'))).toBe(false);
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });
});
