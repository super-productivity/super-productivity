import type { LwwResolvedConflict } from '@sp/sync-core';
import {
  ActionType,
  type EntityConflict,
  type Operation,
  isLwwUpdatePayload,
  OpType,
} from '../core/operation.types';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';

import { isTimePreservingTaskSnapshot } from './time-preserving-task-snapshot.util';

type Resolution = LwwResolvedConflict<Operation, EntityConflict>;

export interface MultiEntityRemoteOpWinners {
  op: Operation;
  hasLocalWinner: boolean;
  hasRemoteWinner: boolean;
  localWinnerKeys: Set<string>;
  resolvedEntityKeys: Set<string>;
  localWinOpIds: Set<string>;
  remoteWinCompensationIds: Set<string>;
}

/** Collect atomic remote actions whose per-entity winners need compensation. */
export const collectMultiEntityRemoteOpWinners = (
  resolutions: Resolution[],
): Map<string, MultiEntityRemoteOpWinners> => {
  const multiEntityRemoteOpWinners = new Map<string, MultiEntityRemoteOpWinners>();
  for (const resolution of resolutions) {
    for (const remoteOp of resolution.conflict.remoteOps) {
      if (getOpEntityIds(remoteOp).length <= 1) {
        continue;
      }
      const winners = multiEntityRemoteOpWinners.get(remoteOp.id) ?? {
        op: remoteOp,
        hasLocalWinner: false,
        hasRemoteWinner: false,
        localWinnerKeys: new Set<string>(),
        resolvedEntityKeys: new Set<string>(),
        localWinOpIds: new Set<string>(),
        remoteWinCompensationIds: new Set<string>(),
      };
      winners.resolvedEntityKeys.add(
        toEntityKey(resolution.conflict.entityType, resolution.conflict.entityId),
      );
      if (resolution.winner === 'local') {
        winners.hasLocalWinner = true;
        winners.localWinnerKeys.add(
          toEntityKey(resolution.conflict.entityType, resolution.conflict.entityId),
        );
        if (resolution.localWinOp) {
          winners.localWinOpIds.add(resolution.localWinOp.id);
        }
      } else {
        winners.hasRemoteWinner = true;
      }
      multiEntityRemoteOpWinners.set(remoteOp.id, winners);
    }
  }

  // Conflict detection reports only entities that actually conflict. Every
  // other entity touched by the same remote atomic action is therefore an
  // uncontested remote winner and must keep the original op eligible for
  // apply. Without this, one local-winning sibling suppresses the remote
  // change for every unaffected sibling.
  for (const winners of multiEntityRemoteOpWinners.values()) {
    winners.hasRemoteWinner ||= getOpEntityIds(winners.op).some(
      (entityId) =>
        !winners.resolvedEntityKeys.has(toEntityKey(winners.op.entityType, entityId)),
    );
  }

  return multiEntityRemoteOpWinners;
};

/** Select existing replacement rows to apply in their durable loser/winner order. */
export const selectTaskReplacementCompensations = (
  resolutions: Resolution[],
): { remoteOp: Operation; localWinOpId: string }[] => {
  const pairs: { remoteOp: Operation; localWinOpId: string }[] = [];
  // A losing TASK replacement can remove relationship membership on replay.
  // Apply it before its existing winning replacement so live state follows
  // the same durable sequence (including Today ordering) as hydration.
  for (const { winner, conflict, localWinOp } of resolutions) {
    if (
      winner !== 'local' ||
      !localWinOp ||
      localWinOp.entityType !== 'TASK' ||
      localWinOp.opType !== OpType.Update ||
      getOpEntityIds(localWinOp).length !== 1 ||
      !isLwwUpdatePayload(localWinOp.payload) ||
      (localWinOp.payload.lwwUpdateMode !== 'replace' &&
        !isTimePreservingTaskSnapshot(localWinOp)) ||
      localWinOp.payload.recreatesEntityAfterDelete === true ||
      conflict.localOps.some(
        (op) =>
          op.opType === OpType.Delete ||
          op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          getOpEntityIds(op).length !== 1,
      )
    )
      continue;
    for (const remoteOp of conflict.remoteOps) {
      if (
        remoteOp.entityType !== 'TASK' ||
        remoteOp.opType !== OpType.Update ||
        getOpEntityIds(remoteOp).length !== 1 ||
        !isLwwUpdatePayload(remoteOp.payload) ||
        (remoteOp.payload.lwwUpdateMode !== 'replace' &&
          !isTimePreservingTaskSnapshot(remoteOp)) ||
        remoteOp.payload.recreatesEntityAfterDelete === true
      )
        continue;
      pairs.push({ remoteOp, localWinOpId: localWinOp.id });
    }
  }

  return pairs;
};
