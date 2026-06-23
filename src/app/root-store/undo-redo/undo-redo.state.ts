/**
 * Undo state
 *
 * Simple stacks-based approach using Operations as source of truth:
 * - When user does action → Operation created → added to undoStack
 * - Undo (Ctrl+Z) → service dispatches undo + compensating action
 * - Snackbar restore → service dispatches the original persisted action once
 *
 * IMPORTANT: Undo actions are marked with meta.isCompensating so they are
 * persisted and synced, but not re-added to the local undo stack.
 */

import { Operation } from '../../op-log/core/operation.types';

export interface UndoRedoState {
  /**
   * Stack of operations that can be undone
   * Most recent operation is at index 0
   */
  undoStack: Operation[];

  /**
   * Local-only undo snapshots keyed by operation id.
   * These snapshots are never written to the op-log or synced.
   */
  undoPayloadByOperationId: Record<string, unknown>;

  /**
   * Last operation undone by the user.
   * Used only for the snackbar restore action, not as a full redo history.
   */
  lastUndoneOperation: Operation | null;

  /**
   * Maximum number of operations to keep in history
   */
  maxHistorySize: number;
}

export const initialUndoRedoState: UndoRedoState = {
  undoStack: [],
  undoPayloadByOperationId: {},
  lastUndoneOperation: null,
  maxHistorySize: 50,
};
