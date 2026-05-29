/**
 * Undo/Redo State
 *
 * Simple stacks-based approach using Operations as source of truth:
 * - When user does action → Operation created → added to undoStack
 * - Undo (Ctrl+Z) → service dispatches undo + compensating action
 * - Redo (Ctrl+Shift+Z) → service dispatches redo + original persisted action
 *
 * IMPORTANT: Undo/redo actions are marked with meta.isCompensating so they are
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
   * Stack of operations that can be redone
   * Most recent undone operation is at index 0
   */
  redoStack: Operation[];

  /**
   * Maximum number of operations to keep in history
   */
  maxHistorySize: number;
}

export const initialUndoRedoState: UndoRedoState = {
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,
};
