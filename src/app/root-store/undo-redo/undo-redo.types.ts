import { Action } from '@ngrx/store';
import { ActionType, Operation } from '../../op-log/core/operation.types';

export enum UndoRedoErrorCode {
  NoOperation = 'NO_OPERATION',
  UnsupportedOperation = 'UNSUPPORTED_OPERATION',
  MissingPayload = 'MISSING_PAYLOAD',
  MissingEntity = 'MISSING_ENTITY',
  MissingSnapshot = 'MISSING_SNAPSHOT',
  ValidationFailed = 'VALIDATION_FAILED',
}

export interface UndoRedoError {
  code: UndoRedoErrorCode;
  message: string;
}

export enum UndoRedoOperationType {
  Create = 'CREATE',
  Delete = 'DELETE',
  Update = 'UPDATE',
}

export interface SnapshotValue {
  value: unknown;
  wasPresent: boolean;
}

export interface SnapshotPayload {
  previousValues?: Record<string, SnapshotValue>;
}

export interface UndoRedoOperation {
  originalOperation: Operation;
  operationType: UndoRedoOperationType;
  actionType: ActionType;
  label: string;
}

export interface CompensatingOp {
  originalOperationId: string;
  label: string;
  action: Action;
}

export type UndoRedoResult =
  | {
      success: true;
      operation: UndoRedoOperation;
      compensatingOp: CompensatingOp;
    }
  | {
      success: false;
      error: UndoRedoError;
      operation?: Operation;
    };
