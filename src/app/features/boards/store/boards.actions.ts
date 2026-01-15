import { createAction } from '@ngrx/store';
import { BoardCfg, BoardPanelCfg } from '../boards.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const addBoard = createAction(
  '[Boards] Add Board',
  (actionProps: { board: BoardCfg }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'BOARD',
      entityId: actionProps.board.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const updateBoard = createAction(
  '[Boards] Update Board',
  (actionProps: { id: string; updates: Partial<BoardCfg> }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'BOARD',
      entityId: actionProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const removeBoard = createAction(
  '[Boards] Remove Board',
  (actionProps: { id: string }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'BOARD',
      entityId: actionProps.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const updatePanelCfg = createAction(
  '[Boards] Update Panel Cfg',
  (actionProps: { panelCfg: BoardPanelCfg }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'BOARD',
      entityId: actionProps.panelCfg.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const updatePanelCfgTaskIds = createAction(
  '[Boards] Update Panel Cfg TaskIds',
  (actionProps: { panelId: string; taskIds: string[] }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'BOARD',
      entityId: actionProps.panelId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

// Namespace for backward compatibility with existing code using BoardsActions.*
export const BoardsActions = {
  addBoard,
  updateBoard,
  removeBoard,
  updatePanelCfg,
  updatePanelCfgTaskIds,
};
