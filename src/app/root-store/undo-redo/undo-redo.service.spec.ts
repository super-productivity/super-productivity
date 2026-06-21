import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { UndoRedoService } from './undo-redo.service';
import { Store } from '@ngrx/store';
import { CompensatingOperationsRegistry } from './compensating-operations-registry.service';
import { UndoValidatorService } from './undo-validator.service';
import { UndoRedoActions } from './undo-redo.actions';
import {
  selectLastUndoneOperation,
  selectLastUndoOperation,
  selectLastUndoOperationPayload,
  selectCanUndo,
} from './undo-redo.selectors';
import { ActionType, Operation } from '../../op-log/core/operation.types';
import { UndoRedoOperationType } from './undo-redo.types';
import { UNDO_OPERATION_PAYLOAD_KEY } from '../meta/undo-operation-payload.meta-reducer';
import { TASK_UPDATE_UNDO_PAYLOAD_TYPE } from '../meta/undo-task-update.meta-reducer';

describe('UndoRedoService', () => {
  let service: UndoRedoService;
  let mockStore: jasmine.SpyObj<Store<any>>;
  let mockRegistry: jasmine.SpyObj<CompensatingOperationsRegistry>;
  let mockValidator: jasmine.SpyObj<UndoValidatorService>;

  const createOp = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'op-1',
      actionType: ActionType.TASK_SHARED_ADD,
      opType: 'CRT' as any,
      payload: {},
      clientId: 'client-1',
      timestamp: Date.now(),
      vectorClock: {},
      entityType: 'TASK' as any,
      schemaVersion: 1,
      ...overrides,
    }) as Operation;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    mockRegistry = jasmine.createSpyObj('CompensatingOperationsRegistry', [
      'getCompensatingOp',
      'convertOpToAction',
    ]);
    mockValidator = jasmine.createSpyObj('UndoValidatorService', [
      'validateLastOperation',
    ]);

    TestBed.configureTestingModule({
      providers: [
        UndoRedoService,
        { provide: Store, useValue: mockStore },
        { provide: CompensatingOperationsRegistry, useValue: mockRegistry },
        { provide: UndoValidatorService, useValue: mockValidator },
      ],
    });

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });

    service = TestBed.inject(UndoRedoService);
  });

  it('undo() should fail when there is no operation in undo stack', async () => {
    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoOperation) {
        return of(undefined);
      }
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });

    const result = await service.undo();

    expect(result.success).toBeFalse();
    if (!result.success) {
      expect(result.error.code).toBe('NO_OPERATION');
    }
    expect(mockRegistry.getCompensatingOp).not.toHaveBeenCalled();
    expect(mockStore.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.undo.type }),
    );
  });

  it('undo() should succeed when there is an undoable operation and registry returns compensating op', async () => {
    const op = createOp();
    // select for last undo op
    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(true);
      }
      return of(undefined);
    });

    mockValidator.validateLastOperation.and.returnValue(null);

    mockRegistry.getCompensatingOp.and.returnValue(
      Promise.resolve({
        operation: {
          originalOperation: op,
          operationType: UndoRedoOperationType.Create,
          actionType: op.actionType,
          label: 'Undo task creation',
        },
        compensatingOp: {
          originalOperationId: op.id,
          label: 'Undo add',
          action: {
            type: '[Task] Delete',
            meta: {
              isPersistent: true,
              entityType: 'TASK',
            },
          } as any,
        },
      }),
    );

    const result = await service.undo();

    expect(result.success).toBeTrue();
    expect(result.operation).toBeDefined();
    expect(mockRegistry.getCompensatingOp).toHaveBeenCalledWith(op, undefined);
    expect(mockRegistry.getCompensatingOp).toHaveBeenCalledTimes(1);
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.undo.type }),
    );
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.undoRedoSuccess.type }),
    );
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: '[Task] Delete',
        meta: jasmine.objectContaining({
          isPersistent: true,
          entityType: 'TASK',
          isCompensating: true,
        }),
      }),
    );
    const dispatchCalls = mockStore.dispatch.calls
      .allArgs()
      .map(([action]) => action as unknown as { type: string });
    const compensatingActionIndex = dispatchCalls.findIndex(
      (action) => action.type === '[Task] Delete',
    );
    const undoStackMutationIndex = dispatchCalls.findIndex(
      (action) => action.type === UndoRedoActions.undo.type,
    );
    expect(compensatingActionIndex).toBeLessThan(undoStackMutationIndex);
  });

  it('undo() should pass the local undo payload to the registry', async () => {
    const op = createOp();
    const undoPayload = { snapshot: { previousValues: {} } };
    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoOperation) {
        return of(op);
      }
      if (selector === selectLastUndoOperationPayload) {
        return of(undoPayload);
      }
      return of(undefined);
    });
    mockValidator.validateLastOperation.and.returnValue(null);
    mockRegistry.getCompensatingOp.and.returnValue(
      Promise.resolve({
        operation: {
          originalOperation: op,
          operationType: UndoRedoOperationType.Create,
          actionType: op.actionType,
          label: 'Undo task creation',
        },
        compensatingOp: {
          originalOperationId: op.id,
          label: 'Undo add',
          action: { type: '[Task] Delete' } as any,
        },
      }),
    );

    await service.undo();

    expect(mockRegistry.getCompensatingOp).toHaveBeenCalledWith(op, undoPayload);
  });

  it('undo() should ignore a concurrent undo while the first undo is in flight', async () => {
    const op = createOp();
    const compensation = {
      operation: {
        originalOperation: op,
        operationType: UndoRedoOperationType.Create,
        actionType: op.actionType,
        label: 'Undo task creation',
      },
      compensatingOp: {
        originalOperationId: op.id,
        label: 'Undo add',
        action: {
          type: '[Task] Delete',
        } as any,
      },
    };
    let resolveCompensation: (value: typeof compensation) => void = () => undefined;
    const pendingCompensation = new Promise<typeof compensation>((resolve) => {
      resolveCompensation = resolve;
    });

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(true);
      }
      return of(undefined);
    });
    mockValidator.validateLastOperation.and.returnValue(null);
    mockRegistry.getCompensatingOp.and.returnValue(pendingCompensation);

    const firstResult = service.undo();
    const secondResult = await service.undo();
    resolveCompensation(compensation);

    expect(secondResult.success).toBeFalse();
    if (!secondResult.success) {
      expect(secondResult.error.code).toBe('NO_OPERATION');
    }

    expect((await firstResult).success).toBeTrue();
    expect(mockRegistry.getCompensatingOp).toHaveBeenCalledTimes(1);
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Task] Delete' }),
    );
  });

  it('restoreLastUndoneOperation() should dispatch redo as a normal undoable action', async () => {
    const op = createOp({ id: 'redo-op' });

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoneOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });

    const redoAction = {
      type: '[Task] Add',
      meta: {
        isPersistent: true,
        entityType: 'TASK',
        isRemote: true,
      },
    } as any;
    mockRegistry.convertOpToAction.and.returnValue(Promise.resolve(redoAction));

    const result = await service.restoreLastUndoneOperation();

    expect(result.success).toBeTrue();
    if (result.success) {
      expect(result.compensatingOp).toBeDefined();
      expect(result.compensatingOp.originalOperationId).toBe(op.id);
    }
    expect(mockRegistry.convertOpToAction).toHaveBeenCalledWith(op);
    expect(mockRegistry.convertOpToAction).toHaveBeenCalledTimes(1);
    expect(mockStore.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.restoreLastUndoneOperation.type }),
    );
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.clearLastUndoneOperation.type }),
    );
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: '[Task] Add',
        meta: jasmine.objectContaining({
          isPersistent: true,
          entityType: 'TASK',
          isRemote: false,
        }),
      }),
    );
    expect(mockStore.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: '[Task] Add',
        meta: jasmine.objectContaining({
          isCompensating: true,
        }),
      }),
    );
  });

  it('restoreLastUndoneOperation() should ignore a concurrent redo while the first redo is in flight', async () => {
    const op = createOp({ id: 'redo-op' });
    const redoAction = {
      type: '[Task] Add',
    } as any;
    let resolveRedoAction: (value: typeof redoAction) => void = () => undefined;
    const pendingRedoAction = new Promise<typeof redoAction>((resolve) => {
      resolveRedoAction = resolve;
    });

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoneOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });
    mockRegistry.convertOpToAction.and.returnValue(pendingRedoAction);

    const firstResult = service.restoreLastUndoneOperation();
    const secondResult = await service.restoreLastUndoneOperation();
    resolveRedoAction(redoAction);

    expect(secondResult.success).toBeFalse();
    if (!secondResult.success) {
      expect(secondResult.error.code).toBe('NO_OPERATION');
    }

    expect((await firstResult).success).toBeTrue();
    expect(mockRegistry.convertOpToAction).toHaveBeenCalledTimes(1);
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Task] Add' }),
    );
  });

  it('restoreLastUndoneOperation() should fail when there is no operation in last undone operation', async () => {
    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoneOperation) {
        return of(undefined);
      }
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });

    const result = await service.restoreLastUndoneOperation();

    expect(result.success).toBeFalse();
    if (!result.success) {
      expect(result.error.code).toBe('NO_OPERATION');
    }
    expect(mockRegistry.convertOpToAction).not.toHaveBeenCalled();
    expect(mockStore.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.restoreLastUndoneOperation.type }),
    );
  });

  it('restoreLastUndoneOperation() should fail when registry cannot convert operation to action', async () => {
    const op = createOp({ id: 'redo-op', actionType: ActionType.TASK_ADD_SUB });

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoneOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(false);
      }
      return of(undefined);
    });

    mockRegistry.convertOpToAction.and.returnValue(
      Promise.resolve({
        code: 'MISSING_PAYLOAD',
        message: 'Cannot redo sub task creation without task and parent payload.',
      } as any),
    );

    const result = await service.restoreLastUndoneOperation();

    expect(result.success).toBeFalse();
    if (!result.success) {
      expect(result.error.code).toBe('MISSING_PAYLOAD');
    }
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.undoRedoFailed.type }),
    );
    expect(mockStore.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.restoreLastUndoneOperation.type }),
    );
  });

  it('undo() should fail when validator rejects the last operation', async () => {
    const op = createOp();

    mockStore.select.and.callFake((selector: any) => {
      if (selector === selectLastUndoOperation) {
        return of(op);
      }
      if (selector === selectCanUndo) {
        return of(true);
      }
      return of(undefined);
    });

    const validationError = { code: 'TEST_REJECT', message: 'Not allowed' } as any;
    mockValidator.validateLastOperation.and.returnValue(validationError);

    const result = await service.undo();

    expect(result.success).toBeFalse();
    if (!result.success) {
      expect(result.error).toBe(validationError);
    }
    expect(mockStore.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: UndoRedoActions.undoRedoFailed.type }),
    );
  });

  describe('Specific Operation Type Undo Tests', () => {
    it('should undo TASK_SHARED_ADD by generating a delete compensation', async () => {
      const addOp = createOp({
        id: 'op-add-task',
        actionType: ActionType.TASK_SHARED_ADD,
        entityId: 'task-123',
        payload: {
          actionPayload: {
            task: {
              id: 'task-123',
              title: 'Test Task',
              isDone: false,
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(addOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: addOp,
            operationType: UndoRedoOperationType.Create,
            actionType: ActionType.TASK_SHARED_ADD,
            label: 'Undo task creation',
          },
          compensatingOp: {
            originalOperationId: addOp.id,
            label: 'Undo task creation',
            action: {
              type: '[Task] Delete',
              payload: {
                task: { id: 'task-123', title: 'Test Task' },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      if (result.success && result.operation && 'operationType' in result.operation) {
        expect((result.operation as any).operationType).toBe(
          UndoRedoOperationType.Create,
        );
      }
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Delete' }),
      );
    });

    it('should undo TASK_SHARED_DELETE by generating a restore compensation', async () => {
      const deleteOp = createOp({
        id: 'op-delete-task',
        actionType: ActionType.TASK_SHARED_DELETE,
        entityId: 'task-456',
        payload: {
          actionPayload: {
            task: {
              id: 'task-456',
              title: 'Deleted Task',
              isDone: true,
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(deleteOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: deleteOp,
            operationType: UndoRedoOperationType.Delete,
            actionType: ActionType.TASK_SHARED_DELETE,
            label: 'Undo task deletion',
          },
          compensatingOp: {
            originalOperationId: deleteOp.id,
            label: 'Undo task deletion',
            action: {
              type: '[Task] Restore',
              payload: {
                task: { id: 'task-456', title: 'Deleted Task' },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      if (result.success && result.operation && 'operationType' in result.operation) {
        expect((result.operation as any).operationType).toBe(
          UndoRedoOperationType.Delete,
        );
      }
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Restore' }),
      );
    });

    it('should undo TASK_ADD_SUB (create subtask) by generating a delete compensation', async () => {
      const addSubOp = createOp({
        id: 'op-add-sub',
        actionType: ActionType.TASK_ADD_SUB,
        entityId: 'sub-789',
        payload: {
          actionPayload: {
            parentId: 'parent-task',
            task: {
              id: 'sub-789',
              title: 'New Subtask',
              isDone: false,
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(addSubOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: addSubOp,
            operationType: UndoRedoOperationType.Create,
            actionType: ActionType.TASK_ADD_SUB,
            label: 'Undo sub task creation',
          },
          compensatingOp: {
            originalOperationId: addSubOp.id,
            label: 'Undo sub task creation',
            action: {
              type: '[Task] Delete',
              payload: {
                task: {
                  id: 'sub-789',
                  title: 'New Subtask',
                  parentId: 'parent-task',
                },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      if (result.success && result.operation && 'operationType' in result.operation) {
        expect((result.operation as any).operationType).toBe(
          UndoRedoOperationType.Create,
        );
      }
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Delete' }),
      );
    });

    it('should undo TASK_SHARED_UPDATE by restoring previous values from snapshot', async () => {
      const updateOp = createOp({
        id: 'op-update-task',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-999',
        payload: {
          actionPayload: {
            task: {
              id: 'task-999',
              changes: {
                title: 'Updated Title',
                isDone: true,
              },
            },
            [UNDO_OPERATION_PAYLOAD_KEY]: {
              type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
              snapshot: {
                previousValues: {
                  title: { value: 'Original Title', wasPresent: true },
                  isDone: { value: false, wasPresent: true },
                },
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(updateOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: updateOp,
            operationType: UndoRedoOperationType.Update,
            actionType: ActionType.TASK_SHARED_UPDATE,
            label: 'Undo task update',
          },
          compensatingOp: {
            originalOperationId: updateOp.id,
            label: 'Undo task update',
            action: {
              type: '[Task] Update',
              payload: {
                task: {
                  id: 'task-999',
                  changes: {
                    title: 'Original Title',
                    isDone: false,
                  },
                },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      if (result.success && result.operation && 'operationType' in result.operation) {
        expect((result.operation as any).operationType).toBe(
          UndoRedoOperationType.Update,
        );
      }
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Update' }),
      );
    });

    it('should redo TASK_SHARED_ADD by reconstructing the original add action', async () => {
      const addOp = createOp({
        id: 'op-add-task-redo',
        actionType: ActionType.TASK_SHARED_ADD,
        entityId: 'task-123',
        payload: {
          actionPayload: {
            task: {
              id: 'task-123',
              title: 'Test Task for Redo',
              isDone: false,
            },
            workContextId: 'TODAY',
            workContextType: 'WORK_CONTEXT',
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(addOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Add',
          payload: {
            task: { id: 'task-123', title: 'Test Task for Redo' },
            workContextId: 'TODAY',
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      if (result.success && result.compensatingOp) {
        expect(result.compensatingOp.originalOperationId).toBe(addOp.id);
      }
      expect(mockRegistry.convertOpToAction).toHaveBeenCalledWith(addOp);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Add' }),
      );
    });

    it('should redo TASK_SHARED_DELETE by reconstructing the original delete action', async () => {
      const deleteOp = createOp({
        id: 'op-delete-task-redo',
        actionType: ActionType.TASK_SHARED_DELETE,
        entityId: 'task-456',
        payload: {
          actionPayload: {
            task: {
              id: 'task-456',
              title: 'Task to Delete for Redo',
              isDone: false,
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(deleteOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Delete',
          payload: {
            task: { id: 'task-456', title: 'Task to Delete for Redo' },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      if (result.success && result.compensatingOp) {
        expect(result.compensatingOp.originalOperationId).toBe(deleteOp.id);
      }
      expect(mockRegistry.convertOpToAction).toHaveBeenCalledWith(deleteOp);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Delete' }),
      );
    });

    it('should redo TASK_ADD_SUB (create subtask) by reconstructing the original add action', async () => {
      const addSubOp = createOp({
        id: 'op-add-sub-redo',
        actionType: ActionType.TASK_ADD_SUB,
        entityId: 'sub-789',
        payload: {
          actionPayload: {
            parentId: 'parent-task',
            task: {
              id: 'sub-789',
              title: 'Subtask for Redo',
              isDone: false,
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(addSubOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Add Subtask',
          payload: {
            parentId: 'parent-task',
            task: { id: 'sub-789', title: 'Subtask for Redo' },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      if (result.success && result.compensatingOp) {
        expect(result.compensatingOp.originalOperationId).toBe(addSubOp.id);
      }
      expect(mockRegistry.convertOpToAction).toHaveBeenCalledWith(addSubOp);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Add Subtask' }),
      );
    });

    it('should redo TASK_SHARED_UPDATE by reconstructing the original update action', async () => {
      const updateOp = createOp({
        id: 'op-update-task-redo',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-999',
        payload: {
          actionPayload: {
            task: {
              id: 'task-999',
              changes: {
                title: 'Updated Title for Redo',
                isDone: true,
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(updateOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Update',
          payload: {
            task: {
              id: 'task-999',
              changes: {
                title: 'Updated Title for Redo',
                isDone: true,
              },
            },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      if (result.success && result.compensatingOp) {
        expect(result.compensatingOp.originalOperationId).toBe(updateOp.id);
      }
      expect(mockRegistry.convertOpToAction).toHaveBeenCalledWith(updateOp);
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Update' }),
      );
    });

    it('should undo TASK_SHARED_UPDATE changing title field', async () => {
      const updateTitleOp = createOp({
        id: 'op-update-title',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-title',
        payload: {
          actionPayload: {
            task: {
              id: 'task-title',
              changes: {
                title: 'New Title',
              },
            },
            [UNDO_OPERATION_PAYLOAD_KEY]: {
              type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
              snapshot: {
                previousValues: {
                  title: { value: 'Old Title', wasPresent: true },
                },
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(updateTitleOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: updateTitleOp,
            operationType: UndoRedoOperationType.Update,
            actionType: ActionType.TASK_SHARED_UPDATE,
            label: 'Undo title change',
          },
          compensatingOp: {
            originalOperationId: updateTitleOp.id,
            label: 'Undo title change',
            action: {
              type: '[Task] Update',
              payload: {
                task: {
                  id: 'task-title',
                  changes: { title: 'Old Title' },
                },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ title: 'Old Title' }),
            }),
          }),
        }),
      );
    });

    it('should undo TASK_SHARED_UPDATE changing isDone field', async () => {
      const updateDoneOp = createOp({
        id: 'op-update-done',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-done',
        payload: {
          actionPayload: {
            task: {
              id: 'task-done',
              changes: {
                isDone: true,
              },
            },
            [UNDO_OPERATION_PAYLOAD_KEY]: {
              type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
              snapshot: {
                previousValues: {
                  isDone: { value: false, wasPresent: true },
                },
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(updateDoneOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: updateDoneOp,
            operationType: UndoRedoOperationType.Update,
            actionType: ActionType.TASK_SHARED_UPDATE,
            label: 'Undo done status change',
          },
          compensatingOp: {
            originalOperationId: updateDoneOp.id,
            label: 'Undo done status change',
            action: {
              type: '[Task] Update',
              payload: {
                task: {
                  id: 'task-done',
                  changes: { isDone: false },
                },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ isDone: false }),
            }),
          }),
        }),
      );
    });

    it('should undo TASK_SHARED_UPDATE changing timeEstimate field', async () => {
      const updateEstimateOp = createOp({
        id: 'op-update-estimate',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-estimate',
        payload: {
          actionPayload: {
            task: {
              id: 'task-estimate',
              changes: {
                timeEstimate: 3600,
              },
            },
            [UNDO_OPERATION_PAYLOAD_KEY]: {
              type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
              snapshot: {
                previousValues: {
                  timeEstimate: { value: 1800, wasPresent: true },
                },
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoOperation) {
          return of(updateEstimateOp);
        }
        if (selector === selectCanUndo) {
          return of(true);
        }
        return of(undefined);
      });

      mockValidator.validateLastOperation.and.returnValue(null);

      mockRegistry.getCompensatingOp.and.returnValue(
        Promise.resolve({
          operation: {
            originalOperation: updateEstimateOp,
            operationType: UndoRedoOperationType.Update,
            actionType: ActionType.TASK_SHARED_UPDATE,
            label: 'Undo time estimate change',
          },
          compensatingOp: {
            originalOperationId: updateEstimateOp.id,
            label: 'Undo time estimate change',
            action: {
              type: '[Task] Update',
              payload: {
                task: {
                  id: 'task-estimate',
                  changes: { timeEstimate: 1800 },
                },
              },
            } as any,
          },
        }),
      );

      const result = await service.undo();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ timeEstimate: 1800 }),
            }),
          }),
        }),
      );
    });

    it('should redo TASK_SHARED_UPDATE changing title field', async () => {
      const updateTitleOp = createOp({
        id: 'op-update-title-redo',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-title',
        payload: {
          actionPayload: {
            task: {
              id: 'task-title',
              changes: {
                title: 'New Title',
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(updateTitleOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Update',
          payload: {
            task: {
              id: 'task-title',
              changes: { title: 'New Title' },
            },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ title: 'New Title' }),
            }),
          }),
        }),
      );
    });

    it('should redo TASK_SHARED_UPDATE changing isDone field', async () => {
      const updateDoneOp = createOp({
        id: 'op-update-done-redo',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-done',
        payload: {
          actionPayload: {
            task: {
              id: 'task-done',
              changes: {
                isDone: true,
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(updateDoneOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Update',
          payload: {
            task: {
              id: 'task-done',
              changes: { isDone: true },
            },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ isDone: true }),
            }),
          }),
        }),
      );
    });

    it('should redo TASK_SHARED_UPDATE changing timeEstimate field', async () => {
      const updateEstimateOp = createOp({
        id: 'op-update-estimate-redo',
        actionType: ActionType.TASK_SHARED_UPDATE,
        entityId: 'task-estimate',
        payload: {
          actionPayload: {
            task: {
              id: 'task-estimate',
              changes: {
                timeEstimate: 3600,
              },
            },
          },
        },
      });

      mockStore.select.and.callFake((selector: any) => {
        if (selector === selectLastUndoneOperation) {
          return of(updateEstimateOp);
        }
        if (selector === selectCanUndo) {
          return of(false);
        }
        return of(undefined);
      });

      mockRegistry.convertOpToAction.and.returnValue(
        Promise.resolve({
          type: '[Task] Update',
          payload: {
            task: {
              id: 'task-estimate',
              changes: { timeEstimate: 3600 },
            },
          },
        } as any),
      );

      const result = await service.restoreLastUndoneOperation();

      expect(result.success).toBeTrue();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Update',
          payload: jasmine.objectContaining({
            task: jasmine.objectContaining({
              changes: jasmine.objectContaining({ timeEstimate: 3600 }),
            }),
          }),
        }),
      );
    });
  });
});
