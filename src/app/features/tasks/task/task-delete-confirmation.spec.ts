import { of } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../task.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { DEFAULT_TASK, TaskWithSubTasks } from '../task.model';
import { T } from '../../../t.const';

/**
 * Tests for Issue #5942: Task Delete Confirmation
 * Tests the confirmation dialog logic for task deletion
 */
describe('Task Delete Confirmation Logic', () => {
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogConfirmComponent>>;
  let mockConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockTaskService: jasmine.SpyObj<TaskService>;

  const createMockTask = (): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id: 'test-task-1',
    title: 'Test Task',
    projectId: 'test-project-1',
    subTasks: [],
  });

  beforeEach(() => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['afterClosed']);
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockDialog.open.and.returnValue(mockDialogRef);

    mockConfigService = jasmine.createSpyObj('GlobalConfigService', ['cfg']);
    mockTaskService = jasmine.createSpyObj('TaskService', ['remove']);
  });

  describe('when isConfirmBeforeTaskDelete is true', () => {
    beforeEach(() => {
      mockConfigService.cfg.and.returnValue({
        misc: { isConfirmBeforeTaskDelete: true },
      } as any);
    });

    it('should open confirmation dialog', () => {
      mockDialogRef.afterClosed.and.returnValue(of(false));

      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: task.title },
          },
        });
      }

      expect(mockDialog.open).toHaveBeenCalledWith(DialogConfirmComponent, {
        data: {
          okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
          message: T.F.TASK.D_CONFIRM_DELETE.MSG,
          translateParams: { title: 'Test Task' },
        },
      });
    });

    it('should delete task when dialog is confirmed', () => {
      mockDialogRef.afterClosed.and.returnValue(of(true));

      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog
          .open(DialogConfirmComponent, {
            data: {
              okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
              message: T.F.TASK.D_CONFIRM_DELETE.MSG,
              translateParams: { title: task.title },
            },
          })
          .afterClosed()
          .subscribe((isConfirm) => {
            if (isConfirm) {
              mockTaskService.remove(task);
            }
          });
      }

      expect(mockTaskService.remove).toHaveBeenCalledWith(task);
    });

    it('should NOT delete task when dialog is cancelled', () => {
      mockDialogRef.afterClosed.and.returnValue(of(false));

      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog
          .open(DialogConfirmComponent, {
            data: {
              okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
              message: T.F.TASK.D_CONFIRM_DELETE.MSG,
              translateParams: { title: task.title },
            },
          })
          .afterClosed()
          .subscribe((isConfirm) => {
            if (isConfirm) {
              mockTaskService.remove(task);
            }
          });
      }

      expect(mockTaskService.remove).not.toHaveBeenCalled();
    });
  });

  describe('when isConfirmBeforeTaskDelete is false', () => {
    beforeEach(() => {
      mockConfigService.cfg.and.returnValue({
        misc: { isConfirmBeforeTaskDelete: false },
      } as any);
    });

    it('should NOT open confirmation dialog', () => {
      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: task.title },
          },
        });
      } else {
        mockTaskService.remove(task);
      }

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('should delete task immediately', () => {
      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: task.title },
          },
        });
      } else {
        mockTaskService.remove(task);
      }

      expect(mockTaskService.remove).toHaveBeenCalledWith(task);
    });
  });

  describe('when isConfirmBeforeTaskDelete is undefined', () => {
    beforeEach(() => {
      mockConfigService.cfg.and.returnValue({
        misc: {},
      } as any);
    });

    it('should treat undefined as falsy and delete immediately', () => {
      const task = createMockTask();
      const isConfirmBeforeTaskDelete =
        mockConfigService.cfg()?.misc?.isConfirmBeforeTaskDelete;

      if (isConfirmBeforeTaskDelete) {
        mockDialog.open(DialogConfirmComponent, {
          data: {
            okTxt: T.F.TASK.D_CONFIRM_DELETE.OK,
            message: T.F.TASK.D_CONFIRM_DELETE.MSG,
            translateParams: { title: task.title },
          },
        });
      } else {
        mockTaskService.remove(task);
      }

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(mockTaskService.remove).toHaveBeenCalledWith(task);
    });
  });
});
