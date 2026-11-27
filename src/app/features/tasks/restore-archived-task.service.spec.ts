import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { RestoreArchivedTaskService } from './restore-archived-task.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectTaskEntities } from './store/task.selectors';
import { DEFAULT_TASK, Task } from './task.model';
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

  const setArchive = (tasks: Task[]): void => {
    taskArchiveService.load.and.resolveTo({
      ids: tasks.map((t) => t.id),
      entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
    });
  };
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
    it('returns the archived task itself for a top-level task', async () => {
      const archived = createTask('a');
      setArchive([archived]);

      expect(await service.findRestorableTask(createTask('a'))).toBe(archived);
    });

    it('returns the archived parent for a sub task', async () => {
      const parent = createTask('parent', { subTaskIds: ['sub'] });
      const sub = createTask('sub', { parentId: 'parent' });
      setArchive([parent, sub]);

      expect(await service.findRestorableTask(sub)).toBe(parent);
    });

    it('returns null for a task that is not in the archive', async () => {
      setArchive([]);

      expect(await service.findRestorableTask(createTask('a'))).toBeNull();
    });

    it('returns null for a sub task whose parent is not in the archive', async () => {
      const sub = createTask('sub', { parentId: 'parent' });
      setArchive([sub]);

      expect(await service.findRestorableTask(sub)).toBeNull();
    });

    it('returns null when the task is already active', async () => {
      const task = createTask('a');
      setArchive([task]);
      store.overrideSelector(selectTaskEntities, { a: task });
      store.refreshState();

      expect(await service.findRestorableTask(task)).toBeNull();
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

    it('dispatches one restoreTask with the current archived parent and sub tasks', async () => {
      const sub1 = createTask('sub1', { parentId: 'parent' });
      const sub2 = createTask('sub2', { parentId: 'parent' });
      // 'gone' is listed on the parent but missing from the archive
      const parent = createTask('parent', { subTaskIds: ['sub1', 'gone', 'sub2'] });
      setArchive([parent, sub1, sub2]);
      setConfirmResult(true);

      const displayedParent = createTask('parent', { title: 'Old title' });
      expect(await service.confirmAndRestore(displayedParent)).toBe(true);

      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.restoreTask({
          task: parent,
          subTasks: [sub1, sub2],
          restoreToToday: { today: '2026-01-05', startOfNextDayDiffMs: 0 },
        }),
      );
    });

    it('does not restore a task removed from the archive', async () => {
      setArchive([]);
      setConfirmResult(true);

      expect(await service.confirmAndRestore(createTask('a'))).toBe(false);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('does not restore an archived copy of an already active task', async () => {
      const task = createTask('a');
      setArchive([task]);
      store.overrideSelector(selectTaskEntities, { a: task });
      store.refreshState();
      setConfirmResult(true);

      expect(await service.confirmAndRestore(task)).toBe(false);
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });
});
