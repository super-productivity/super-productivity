import { inject, Injectable } from '@angular/core';
import {
  convertLocalDeleteRemoteUpdatesToLww,
  deepEqual,
  extractEntityFromPayload as extractEntityFromPayloadCore,
} from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  Operation,
  isLwwUpdatePayload,
  OpType,
} from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { collectDeletedEntityIds } from './collect-deleted-ids.util';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { isSingletonEntityId } from '../core/entity-registry';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { createLWWUpdateOp, mergeAndIncrementClocks } from './lww-update-op.util';
import {
  taskRelationshipPatch,
  markLwwDeleteRecreation,
} from './conflict-resolution.util';

/**
 * Builds the ops that recreate entities (and their children) a conflicting delete removed.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictRecreationOpsService {
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private opLogStore = inject(OperationLogStoreService);
  private entityState = inject(ConflictEntityStateService);

  /**
   * Re-emits the relationships that a rewritten recreate-after-delete TASK op
   * cannot carry by itself. This is used only when an earlier recovery row was
   * rejected and replaced: the parent TASK goes first, any still-present
   * subtasks follow, and a parent TASK snapshot or PROJECT membership patch
   * restores exact relationship ordering last.
   */
  async createTaskRecreationFollowUpOps(
    taskOp: Operation,
    options: { ensureRegularProjectMembership?: boolean } = {},
  ): Promise<Operation[]> {
    if (
      taskOp.entityType !== 'TASK' ||
      !taskOp.entityId ||
      !isLwwUpdatePayload(taskOp.payload) ||
      taskOp.payload.recreatesEntityAfterDelete !== true
    ) {
      return [];
    }
    const taskState = extractActionPayload(taskOp.payload);
    const projectId = taskState['projectId'];
    const parentId = taskState['parentId'];
    if (typeof projectId !== 'string') return [];

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot create TASK recovery follow-ups - no client ID',
      );
      return [];
    }
    let nextClock = mergeAndIncrementClocks(
      [(await this.opLogStore.getVectorClock()) ?? {}, taskOp.vectorClock],
      clientId,
    );
    const followUpOps: Operation[] = [];
    const subTaskIds = taskState['subTaskIds'];
    if (Array.isArray(subTaskIds)) {
      for (const subTaskId of new Set(
        subTaskIds.filter((id): id is string => typeof id === 'string'),
      )) {
        const subTaskState = await this.entityState.getCurrentEntityState(
          'TASK' as EntityType,
          subTaskId,
        );
        if (subTaskState === undefined) continue;
        const subTaskOp = markLwwDeleteRecreation(
          createLWWUpdateOp(
            'TASK' as EntityType,
            subTaskId,
            typeof subTaskState === 'object' && subTaskState !== null
              ? { ...subTaskState, projectId }
              : subTaskState,
            clientId,
            nextClock,
            taskOp.timestamp,
          ),
        );
        followUpOps.push(subTaskOp);
        nextClock = mergeAndIncrementClocks([nextClock, subTaskOp.vectorClock], clientId);
      }
      if (subTaskIds.length > 0) {
        const taskRelationshipOp = markLwwDeleteRecreation(
          createLWWUpdateOp(
            'TASK' as EntityType,
            taskOp.entityId,
            taskRelationshipPatch(taskOp.entityId, taskState),
            clientId,
            nextClock,
            taskOp.timestamp,
            'patch',
          ),
        );
        followUpOps.push(taskRelationshipOp);
        nextClock = mergeAndIncrementClocks(
          [nextClock, taskRelationshipOp.vectorClock],
          clientId,
        );
      }
    }

    if (typeof parentId === 'string') {
      const parentTaskState = await this.entityState.getCurrentEntityState(
        'TASK' as EntityType,
        parentId,
      );
      if (parentTaskState === undefined) {
        return followUpOps;
      }
      followUpOps.push(
        markLwwDeleteRecreation(
          createLWWUpdateOp(
            'TASK' as EntityType,
            parentId,
            taskRelationshipPatch(parentId, parentTaskState as Record<string, unknown>),
            clientId,
            mergeAndIncrementClocks([nextClock], clientId),
            taskOp.timestamp,
            'patch',
          ),
        ),
      );
      return followUpOps;
    }

    const projectState = await this.entityState.getCurrentEntityState(
      'PROJECT' as EntityType,
      projectId,
    );
    if (typeof projectState !== 'object' || projectState === null) {
      return followUpOps;
    }
    const project = projectState as Record<string, unknown>;
    if (!Array.isArray(project['taskIds']) || !Array.isArray(project['backlogTaskIds'])) {
      return followUpOps;
    }
    const taskIds = [...project['taskIds']];
    const backlogTaskIds = [...project['backlogTaskIds']];
    if (
      options.ensureRegularProjectMembership === true &&
      !taskIds.includes(taskOp.entityId) &&
      !backlogTaskIds.includes(taskOp.entityId)
    ) {
      taskIds.push(taskOp.entityId);
    }
    followUpOps.push(
      markLwwDeleteRecreation(
        createLWWUpdateOp(
          'PROJECT' as EntityType,
          projectId,
          {
            id: projectId,
            taskIds,
            backlogTaskIds,
          },
          clientId,
          mergeAndIncrementClocks([nextClock], clientId),
          taskOp.timestamp,
          'patch',
        ),
      ),
    );
    return followUpOps;
  }

  async _createRemoteWinCompensationForRejectedTaskRecreation(
    conflict: EntityConflict,
    remoteOp: Operation,
  ): Promise<Operation | undefined> {
    if (conflict.entityType !== 'TASK' || remoteOp.opType !== OpType.Update) {
      return undefined;
    }
    const localRecreation = conflict.localOps.find(
      (op) =>
        isLwwUpdatePayload(op.payload) && op.payload.recreatesEntityAfterDelete === true,
    );
    if (!localRecreation) return undefined;

    const isMoveToProject =
      remoteOp.actionType === ActionType.TASK_SHARED_MOVE_TO_PROJECT;
    const isTaskLwwUpdate =
      remoteOp.actionType === toLwwUpdateActionType('TASK') &&
      isLwwUpdatePayload(remoteOp.payload);
    const isAdapterTaskUpdate = [
      ActionType.TASK_SHARED_UPDATE,
      ActionType.TASK_UPDATE_UI,
      ActionType.TASK_SHARED_UPDATE_MULTIPLE,
      ActionType.TASK_UPDATE_MULTIPLE_SIMPLE,
    ].includes(remoteOp.actionType);
    if (!isMoveToProject && !isTaskLwwUpdate && !isAdapterTaskUpdate) {
      return undefined;
    }

    const localTaskState = { ...extractActionPayload(localRecreation.payload) };
    delete localTaskState['subTasks'];
    const remoteActionPayload = extractActionPayload(remoteOp.payload);
    const targetProjectId = remoteActionPayload['targetProjectId'];
    let taskState: Record<string, unknown>;
    if (isMoveToProject) {
      if (typeof targetProjectId !== 'string') return undefined;
      // moveToOtherProject carries a full pre-move task snapshot, but only its
      // target project is an intended task-field change.
      taskState = { ...localTaskState, projectId: targetProjectId };
    } else {
      const payloadKey = this.entityState._resolvePayloadKey('TASK' as EntityType);
      const syntheticDelete: Operation = {
        ...localRecreation,
        opType: OpType.Delete,
        payload: {
          actionPayload: {
            [payloadKey]: extractActionPayload(localRecreation.payload),
          },
          entityChanges: [],
        },
      };
      const [convertedRemoteOp] = convertLocalDeleteRemoteUpdatesToLww<Operation>(
        { ...conflict, localOps: [syntheticDelete], remoteOps: [remoteOp] },
        {
          payloadKey,
          toLwwUpdateActionType: (entityType) =>
            toLwwUpdateActionType(entityType as EntityType),
          isSingletonEntityId,
        },
      );
      if (!isLwwUpdatePayload(convertedRemoteOp.payload)) return undefined;
      taskState = { ...extractActionPayload(convertedRemoteOp.payload) };
      delete taskState['subTasks'];

      // Generic adapter/LWW reconstruction is field-safe only. Relationship
      // changes require action-specific parent/project ordering support.
      if (
        !deepEqual(taskState['projectId'], localTaskState['projectId']) ||
        !deepEqual(taskState['parentId'], localTaskState['parentId']) ||
        !deepEqual(taskState['subTaskIds'], localTaskState['subTaskIds'])
      ) {
        return undefined;
      }
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot compensate remote TASK winner - no client ID',
      );
      return undefined;
    }
    return markLwwDeleteRecreation(
      createLWWUpdateOp(
        'TASK' as EntityType,
        conflict.entityId,
        taskState,
        clientId,
        mergeAndIncrementClocks(
          [
            ...conflict.localOps.map((op) => op.vectorClock),
            ...conflict.remoteOps.map((op) => op.vectorClock),
          ],
          clientId,
        ),
        remoteOp.timestamp,
      ),
    );
  }

  /**
   * Creates a durable, single-entity recreate snapshot when one entity in a
   * winning remote multi-entity UPDATE was deleted locally. `null` means the
   * original operation already has recreate semantics; `undefined` means the
   * remote result cannot be reconstructed safely from the available payloads.
   */
  async _createRemoteWinRecreationOp(
    conflict: EntityConflict,
    remoteOp: Operation,
  ): Promise<Operation | null | undefined> {
    if (remoteOp.actionType === toLwwUpdateActionType(remoteOp.entityType)) {
      return null;
    }

    const convertedOp = this.entityState
      ._convertToLWWUpdatesIfNeeded(conflict)
      .find((op) => op.id === remoteOp.id);
    if (
      !convertedOp ||
      convertedOp.actionType !== toLwwUpdateActionType(remoteOp.entityType)
    ) {
      return undefined;
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot create remote-win recreation op - no client ID',
      );
      return undefined;
    }

    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    return markLwwDeleteRecreation(
      createLWWUpdateOp(
        conflict.entityType,
        conflict.entityId,
        extractActionPayload(convertedOp.payload),
        clientId,
        mergeAndIncrementClocks(allClocks, clientId),
        remoteOp.timestamp,
      ),
    );
  }

  async _createSubtaskRecreationOpsFromLocalDelete(
    conflict: EntityConflict,
    parentRecreationOp: Operation,
  ): Promise<Operation[]> {
    if (conflict.entityType !== 'TASK' || !parentRecreationOp.entityId) {
      return [];
    }
    const localDeleteOp = conflict.localOps.find((op) => op.opType === OpType.Delete);
    if (!localDeleteOp) {
      return [];
    }
    const parentSnapshot = extractEntityFromPayloadCore(
      localDeleteOp.payload,
      this.entityState._resolvePayloadKey(conflict.entityType),
      conflict.entityId,
    );
    const subTaskIds = extractActionPayload(parentRecreationOp.payload)['subTaskIds'];
    if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) {
      return [];
    }

    const actionPayload = extractActionPayload(localDeleteOp.payload);
    const snapshotCandidates = [
      ...(Array.isArray(actionPayload['tasks']) ? actionPayload['tasks'] : []),
      ...(Array.isArray(parentSnapshot?.['subTasks']) ? parentSnapshot['subTasks'] : []),
    ];
    const snapshotsById = new Map<string, Record<string, unknown>>();
    for (const candidate of snapshotCandidates) {
      if (typeof candidate !== 'object' || candidate === null) {
        continue;
      }
      const snapshot = candidate as Record<string, unknown>;
      if (typeof snapshot['id'] === 'string') {
        snapshotsById.set(snapshot['id'], snapshot);
      }
    }
    const explicitlyDeletedIds = new Set(getOpEntityIds(localDeleteOp));

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate locally deleted subtasks - no client ID',
      );
      return [];
    }
    const recreationClock = mergeAndIncrementClocks(
      [
        ...conflict.localOps.map((op) => op.vectorClock),
        ...conflict.remoteOps.map((op) => op.vectorClock),
        parentRecreationOp.vectorClock,
      ],
      clientId,
    );
    const recreationOps: Operation[] = [];
    for (const subTaskId of subTaskIds) {
      if (typeof subTaskId !== 'string' || explicitlyDeletedIds.has(subTaskId)) {
        continue;
      }
      const snapshot = snapshotsById.get(subTaskId);
      if (!snapshot) {
        OpLog.err(
          `ConflictResolutionService: Missing local delete snapshot for TASK:${subTaskId}`,
        );
        continue;
      }
      recreationOps.push(
        markLwwDeleteRecreation(
          createLWWUpdateOp(
            'TASK' as EntityType,
            subTaskId,
            snapshot,
            clientId,
            recreationClock,
            parentRecreationOp.timestamp,
          ),
        ),
      );
    }
    return recreationOps;
  }

  /**
   * When a remote bulk delete wins for some tasks but a parent task wins
   * locally (mixed multi-entity winner), the whole remote delete is applied and
   * `handleDeleteTasks` cascade-deletes that parent's subtasks. Only the parent
   * gets an LWW recreate compensation, so the subtasks — pure collateral of the
   * cascade, carrying no local op and not in the delete's entityIds — would be
   * silently and permanently lost across every device (#8956).
   *
   * Emit a recreate-after-delete snapshot for each still-present subtask so the
   * whole surviving subtree propagates. Only TASK entities cascade; subtasks
   * explicitly targeted by the remote op (already resolved on their own) and
   * subtasks deleted on THIS device are left untouched.
   */
  async _createSubtaskRecreationOpsForWinningParent(
    parentCompensationOp: Operation,
    remoteDeleteOp: Operation,
  ): Promise<Operation[]> {
    if (parentCompensationOp.entityType !== 'TASK' || !parentCompensationOp.entityId) {
      return [];
    }
    const parentState = await this.entityState.getCurrentEntityState(
      'TASK' as EntityType,
      parentCompensationOp.entityId,
    );
    const subTaskIds =
      parentState && typeof parentState === 'object'
        ? ((parentState as Record<string, unknown>)['subTaskIds'] as string[] | undefined)
        : undefined;
    if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) {
      return [];
    }
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning parent subtasks - no client ID',
      );
      return [];
    }
    // Subtasks the remote op names explicitly were resolved on their own; do not
    // second-guess them via the parent path.
    const explicitlyTargetedIds = new Set(getOpEntityIds(remoteDeleteOp));
    const recreationOps: Operation[] = [];
    for (const subTaskId of subTaskIds) {
      if (explicitlyTargetedIds.has(subTaskId)) {
        continue;
      }
      // Only resurrect subtasks still present locally: one this device deleted
      // itself (getCurrentEntityState === undefined) must stay deleted.
      const subTaskState = await this.entityState.getCurrentEntityState(
        'TASK' as EntityType,
        subTaskId,
      );
      if (subTaskState === undefined) {
        continue;
      }
      // Dominate the remote delete so the recreation also wins on every client
      // that cascade-deleted this subtask. This clock is a proxy: the subtask
      // carries no local op of its own here (it is pure cascade collateral), so
      // we merge the delete and the parent's compensation clock rather than the
      // subtask's own history. A concurrent individual edit/delete of this
      // subtask on a third device therefore resolves against this proxy clock
      // (and the parent's timestamp) by LWW — the same bounded tradeoff the
      // parent's own recreate-after-delete already makes, and strictly better
      // than the silent total-subtree loss it replaces.
      const newClock = mergeAndIncrementClocks(
        [remoteDeleteOp.vectorClock, parentCompensationOp.vectorClock],
        clientId,
      );
      const recreationOp = createLWWUpdateOp(
        'TASK' as EntityType,
        subTaskId,
        subTaskState,
        clientId,
        newClock,
        parentCompensationOp.timestamp,
      );
      if (!isLwwUpdatePayload(recreationOp.payload)) {
        continue;
      }
      recreationOps.push(markLwwDeleteRecreation(recreationOp));
    }
    return recreationOps;
  }

  /**
   * Recreates the non-task main-state cascade victims of a losing remote
   * `deleteProject` that the task-recovery path leaves deleted: notes, sections,
   * and task-repeat-cfgs. Runs alongside `_createTaskRecreationOpsForWinningProject`
   * on the winner, which still holds every victim at resolution time (the losing
   * delete is never applied live). Without this, the durable loser row replays on
   * every client's status-blind hydration and strips these entities, so the whole
   * fleet converges to a lossy shape (#9037) even though the winning UPDATE meant
   * "keep the project".
   *
   * All three are adapter entities recreated by `lwwUpdateMetaReducer`'s generic
   * `addOne` path (TASK-only logic is gated there). One shared `recreationClock`
   * dominates the delete; every op targets a distinct id, so they never conflict
   * with each other.
   *
   * KNOWN LIMITATIONS (all converge — no split-brain — and are strictly better
   * than losing the entity outright):
   * - Sections and repeat-cfgs have no `modified` field, so their LWW timestamp
   *   falls back to the project timestamp; a CONCURRENT content edit on another
   *   device can be clobbered by the replace snapshot. Notes carry `modified`,
   *   which keeps a concurrent note edit winning.
   * - A note's `NoteState.todayOrder` slot is not restored (the adapter recreate
   *   only touches `entities`/`ids`); a today-pinned note reappears but loses its
   *   today-list ordering. Project-level note membership IS restored via the
   *   project compensation snapshot's `noteIds`.
   * - A section/cfg concurrently ADDED on a third device (not yet applied, so not
   *   enumerable here) is still removed by the loser's dynamic-filter replay.
   * - Like the task path, the merged delete clock can over-resurrect an entity a
   *   third device had already durably deleted before the losing delete synced.
   *
   * Archived tasks, archive time-tracking, current time-tracking, and menu-tree
   * stay outside this path (separate persistence / singleton state) — their own
   * snapshot design is deferred (#9037).
   */
  async _createCascadeRecreationOpsForWinningProject(
    projectCompensationOp: Operation,
    remoteDeleteOp: Operation,
    guard: {
      concurrentlyDeletedTaskIds: ReadonlySet<string>;
      batchOps: readonly Operation[];
    },
  ): Promise<Operation[]> {
    if (
      projectCompensationOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
      !projectCompensationOp.entityId
    ) {
      return [];
    }
    const projectId = projectCompensationOp.entityId;

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning project cascade - no client ID',
      );
      return [];
    }
    const recreationClock = mergeAndIncrementClocks(
      [remoteDeleteOp.vectorClock, projectCompensationOp.vectorClock],
      clientId,
    );

    const buildRecreationOp = (
      entityType: EntityType,
      entityId: string,
      entityState: Record<string, unknown>,
    ): Operation => {
      const modified = entityState['modified'];
      return markLwwDeleteRecreation(
        createLWWUpdateOp(
          entityType,
          entityId,
          entityState,
          clientId,
          recreationClock,
          typeof modified === 'number' ? modified : projectCompensationOp.timestamp,
        ),
      );
    };

    const recreationOps: Operation[] = [];

    // Notes: enumerable from the delete payload's `noteIds`. Guard the array for
    // legacy pre-`noteIds` deleteProject ops (the #9037 rollout window is exactly
    // legacy deletes losing).
    const deletePayload = extractActionPayload(remoteDeleteOp.payload);
    const noteIds = deletePayload['noteIds'];
    if (Array.isArray(noteIds) && noteIds.length > 0) {
      const noteEntities = await this.entityState._getCurrentEntitiesOfType(
        'NOTE' as EntityType,
      );
      const deletedNoteIds = collectDeletedEntityIds(
        guard.batchOps,
        'NOTE' as EntityType,
      );
      for (const noteId of noteIds) {
        if (typeof noteId !== 'string' || deletedNoteIds.has(noteId)) continue;
        const note = noteEntities[noteId] as Record<string, unknown> | undefined;
        if (!note || note['id'] !== noteId) continue;
        recreationOps.push(buildRecreationOp('NOTE' as EntityType, noteId, note));
      }
    }

    // Sections: not in the payload — scan the store for project-owned sections
    // (same predicate as `removeProjectSections`). Strip taskIds pointing at a
    // concurrently-deleted task so the recreated section carries no dangling ref.
    const sectionEntities = await this.entityState._getCurrentEntitiesOfType(
      'SECTION' as EntityType,
    );
    const deletedSectionIds = collectDeletedEntityIds(
      guard.batchOps,
      'SECTION' as EntityType,
    );
    for (const [sectionId, sectionRaw] of Object.entries(sectionEntities)) {
      const section = sectionRaw as Record<string, unknown>;
      if (
        section['id'] !== sectionId ||
        section['contextType'] !== WorkContextType.PROJECT ||
        section['contextId'] !== projectId ||
        deletedSectionIds.has(sectionId)
      ) {
        continue;
      }
      const taskIds = section['taskIds'];
      const cleanedSection = Array.isArray(taskIds)
        ? {
            ...section,
            taskIds: taskIds.filter(
              (id) => typeof id === 'string' && !guard.concurrentlyDeletedTaskIds.has(id),
            ),
          }
        : section;
      recreationOps.push(
        buildRecreationOp('SECTION' as EntityType, sectionId, cleanedSection),
      );
    }

    // Task-repeat-cfgs: not in the payload — scan the store by projectId.
    const repeatCfgEntities = await this.entityState._getCurrentEntitiesOfType(
      'TASK_REPEAT_CFG' as EntityType,
    );
    const deletedRepeatCfgIds = collectDeletedEntityIds(
      guard.batchOps,
      'TASK_REPEAT_CFG' as EntityType,
    );
    for (const [cfgId, cfgRaw] of Object.entries(repeatCfgEntities)) {
      const cfg = cfgRaw as Record<string, unknown>;
      if (
        cfg['id'] !== cfgId ||
        cfg['projectId'] !== projectId ||
        deletedRepeatCfgIds.has(cfgId)
      ) {
        continue;
      }
      recreationOps.push(buildRecreationOp('TASK_REPEAT_CFG' as EntityType, cfgId, cfg));
    }

    return recreationOps;
  }

  /**
   * Recreates the active tasks removed by a losing remote `deleteProject`.
   *
   * The first PROJECT compensation makes the parent available before any TASK
   * recreation is delivered. TASK snapshots then restore every cascade target
   * that still exists locally; a task deleted on this device stays deleted.
   * Finally, a second PROJECT snapshot restores the exact regular/backlog lists
   * after the task entities exist. That last row is required because the LWW
   * reducer filters missing task IDs from a project snapshot, and TASK entities
   * do not encode whether they belong to the regular list or the backlog.
   * Keeping this durable order also works when upload/download pagination puts
   * every compensation in a separate batch.
   *
   * Notes, archived tasks, and other deleteProject cascades are intentionally
   * outside this task-recovery path; they need their own snapshot design.
   */
  async _createTaskRecreationOpsForWinningProject(
    projectCompensationOp: Operation,
    remoteDeleteOp: Operation,
    concurrentlyDeletedTaskIds: ReadonlySet<string> = new Set(),
  ): Promise<Operation[]> {
    if (
      projectCompensationOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
      !projectCompensationOp.entityId
    ) {
      return [];
    }
    const allTaskIds = extractActionPayload(remoteDeleteOp.payload)['allTaskIds'];
    const winningProjectState = extractActionPayload(projectCompensationOp.payload);
    const regularTaskIds = winningProjectState['taskIds'];
    const backlogTaskIds = winningProjectState['backlogTaskIds'];
    const projectRootTaskIds = [
      ...(Array.isArray(regularTaskIds) ? regularTaskIds : []),
      ...(Array.isArray(backlogTaskIds) ? backlogTaskIds : []),
    ].filter((taskId): taskId is string => typeof taskId === 'string');
    const uniqueTaskIds = new Set(
      (Array.isArray(allTaskIds) ? allTaskIds : []).filter(
        (taskId): taskId is string => typeof taskId === 'string',
      ),
    );
    for (const taskId of projectRootTaskIds) uniqueTaskIds.add(taskId);

    const taskStateCache = new Map<string, unknown>();
    const childTaskIds: string[] = [];
    for (const rootTaskId of new Set(projectRootTaskIds)) {
      const rootTaskState = await this.entityState.getCurrentEntityState(
        'TASK' as EntityType,
        rootTaskId,
      );
      taskStateCache.set(rootTaskId, rootTaskState);
      // A root deleted concurrently in this batch takes its subtree with it;
      // don't gather its children only to recreate them as orphans.
      if (concurrentlyDeletedTaskIds.has(rootTaskId)) continue;
      const subTaskIds =
        typeof rootTaskState === 'object' && rootTaskState !== null
          ? (rootTaskState as Record<string, unknown>)['subTaskIds']
          : undefined;
      if (!Array.isArray(subTaskIds)) continue;
      childTaskIds.push(
        ...subTaskIds.filter(
          (subTaskId): subTaskId is string => typeof subTaskId === 'string',
        ),
      );
    }
    for (const taskId of childTaskIds) uniqueTaskIds.add(taskId);
    // Recovery decides "still present" from the pre-batch store, so it cannot
    // see a delete piggybacked as a non-conflicting op in the same batch.
    // Recreating such a task would resurrect it (with a borrowed newer
    // timestamp) on every client that applied the delete, while this client's
    // own delete wins locally — a silent divergence (#8997 review).
    for (const deletedTaskId of concurrentlyDeletedTaskIds) {
      uniqueTaskIds.delete(deletedTaskId);
    }
    if (uniqueTaskIds.size === 0) return [];

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning project tasks - no client ID',
      );
      return [];
    }

    const recreationClock = mergeAndIncrementClocks(
      [remoteDeleteOp.vectorClock, projectCompensationOp.vectorClock],
      clientId,
    );
    const recreationOps: Operation[] = [];
    const recreationTaskStates = new Map<string, unknown>();
    for (const taskId of uniqueTaskIds) {
      const taskState = taskStateCache.has(taskId)
        ? taskStateCache.get(taskId)
        : await this.entityState.getCurrentEntityState('TASK' as EntityType, taskId);
      if (taskState === undefined) {
        continue;
      }
      recreationTaskStates.set(taskId, taskState);
      // Prefer the task's own last-modified time as the LWW timestamp. The
      // project timestamp is unrelated to task content, so borrowing it lets
      // the snapshot clobber a CONCURRENT content edit made on another device;
      // the task's `modified` keeps that edit winning. Clock domination over
      // the delete is independent of this (it comes from recreationClock).
      const taskModified =
        typeof taskState === 'object' && taskState !== null
          ? (taskState as Record<string, unknown>)['modified']
          : undefined;
      recreationOps.push(
        markLwwDeleteRecreation(
          createLWWUpdateOp(
            'TASK' as EntityType,
            taskId,
            taskState,
            clientId,
            recreationClock,
            typeof taskModified === 'number'
              ? taskModified
              : projectCompensationOp.timestamp,
          ),
        ),
      );
    }
    if (recreationOps.length === 0) {
      return [];
    }

    let relationshipClock = mergeAndIncrementClocks(
      [projectCompensationOp.vectorClock, ...recreationOps.map((op) => op.vectorClock)],
      clientId,
    );
    const relationshipOps: Operation[] = [];
    for (const [taskId, taskState] of recreationTaskStates) {
      const subTaskIds =
        typeof taskState === 'object' && taskState !== null
          ? (taskState as Record<string, unknown>)['subTaskIds']
          : undefined;
      if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) continue;
      const relationshipOp = markLwwDeleteRecreation(
        createLWWUpdateOp(
          'TASK' as EntityType,
          taskId,
          taskRelationshipPatch(taskId, taskState as Record<string, unknown>),
          clientId,
          relationshipClock,
          projectCompensationOp.timestamp,
          'patch',
        ),
      );
      relationshipOps.push(relationshipOp);
      relationshipClock = mergeAndIncrementClocks(
        [relationshipClock, relationshipOp.vectorClock],
        clientId,
      );
    }
    const projectMembershipOp = markLwwDeleteRecreation(
      createLWWUpdateOp(
        'PROJECT' as EntityType,
        projectCompensationOp.entityId,
        {
          id: projectCompensationOp.entityId,
          taskIds: winningProjectState['taskIds'],
          backlogTaskIds: winningProjectState['backlogTaskIds'],
        },
        clientId,
        relationshipClock,
        projectCompensationOp.timestamp,
        'patch',
      ),
    );
    return [...recreationOps, ...relationshipOps, projectMembershipOp];
  }
}
