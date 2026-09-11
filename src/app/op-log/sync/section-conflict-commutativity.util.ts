import {
  ActionType,
  extractActionPayload,
  isMultiEntityPayload,
  Operation,
  OpType,
} from '../core/operation.types';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { Section, SectionState } from '../../features/section/section.model';
import { Project, ProjectState } from '../../features/project/project.model';
import { Tag, TagState } from '../../features/tag/tag.model';

interface SectionPlacement {
  sourceSectionId: string | null;
  destinationSectionId: string;
  taskId: string;
  afterTaskId: string | null;
}

interface SectionMove extends SectionPlacement {
  sourceSectionId: string;
}

interface SectionRemoval {
  sectionId: string;
  taskId: string;
  workContextId: string;
  workContextType: WorkContextType;
  workContextAfterTaskId: string | null;
}

interface SectionOrder {
  contextId: string;
  sectionIds: string[];
}

export interface SectionReplaySnapshot {
  section: SectionState;
  project: ProjectState;
  tag: TagState;
}

export interface SectionReplayOrder {
  scope: string;
  position: number;
}

export interface SectionReplayStateCompensation {
  entityType: WorkContextType;
  entityId: string;
  entityState: Project | Tag;
  order: SectionReplayOrder;
}

export type SectionReplayProjection =
  | {
      kind: 'replay';
      operation: Operation;
      order: SectionReplayOrder;
      stateCompensation?: SectionReplayStateCompensation;
    }
  | ({ kind: 'work-context-state' } & SectionReplayStateCompensation)
  | { kind: 'superseded' }
  | { kind: 'blocked'; reason: string };

const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const getReplayScope = (...parts: string[]): string => JSON.stringify(parts);

const getActionPayload = (operation: Operation): Record<string, unknown> | undefined => {
  if (!operation.payload || typeof operation.payload !== 'object') {
    return undefined;
  }
  const payload = extractActionPayload(operation.payload);
  return payload && typeof payload === 'object' ? payload : undefined;
};

const hasExactEntityIds = (operation: Operation, expectedIds: string[]): boolean => {
  const uniqueExpectedIds = Array.from(new Set(expectedIds));
  const declaredIds = getOpEntityIds(operation);
  return (
    uniqueExpectedIds.length === expectedIds.length &&
    declaredIds.length === uniqueExpectedIds.length &&
    uniqueExpectedIds.every((id) => declaredIds.includes(id))
  );
};

const getSectionPlacement = (operation: Operation): SectionPlacement | undefined => {
  if (
    operation.actionType !== ActionType.SECTION_ADD_TASK ||
    operation.entityType !== 'SECTION' ||
    operation.opType !== OpType.Move
  ) {
    return undefined;
  }
  const payload = getActionPayload(operation);
  const sourceSectionId = payload?.['sourceSectionId'];
  const destinationSectionId = payload?.['sectionId'];
  const taskId = payload?.['taskId'];
  const afterTaskId = payload?.['afterTaskId'];
  if (
    !isStringOrNull(sourceSectionId) ||
    typeof destinationSectionId !== 'string' ||
    typeof taskId !== 'string' ||
    !isStringOrNull(afterTaskId)
  ) {
    return undefined;
  }
  const isCrossSectionMove =
    sourceSectionId !== null && sourceSectionId !== destinationSectionId;
  const expectedEntityIds = isCrossSectionMove
    ? [sourceSectionId, destinationSectionId]
    : [destinationSectionId];
  if (
    operation.entityId !== expectedEntityIds[0] ||
    !hasExactEntityIds(operation, expectedEntityIds)
  ) {
    return undefined;
  }
  return { sourceSectionId, destinationSectionId, taskId, afterTaskId };
};

const getSectionMove = (operation: Operation): SectionMove | undefined => {
  const placement = getSectionPlacement(operation);
  if (
    !placement ||
    typeof placement.sourceSectionId !== 'string' ||
    placement.sourceSectionId === placement.destinationSectionId
  ) {
    return undefined;
  }
  return {
    ...placement,
    sourceSectionId: placement.sourceSectionId,
  };
};

const getSectionRemoval = (operation: Operation): SectionRemoval | undefined => {
  if (
    operation.actionType !== ActionType.SECTION_REMOVE_TASK ||
    operation.entityType !== 'SECTION' ||
    operation.opType !== OpType.Update
  ) {
    return undefined;
  }
  const payload = getActionPayload(operation);
  const sectionId = payload?.['sectionId'];
  const taskId = payload?.['taskId'];
  const workContextId = payload?.['workContextId'];
  const workContextType = payload?.['workContextType'];
  const workContextAfterTaskId = payload?.['workContextAfterTaskId'];
  if (
    typeof sectionId !== 'string' ||
    typeof taskId !== 'string' ||
    typeof workContextId !== 'string' ||
    (workContextType !== WorkContextType.PROJECT &&
      workContextType !== WorkContextType.TAG) ||
    !isStringOrNull(workContextAfterTaskId) ||
    operation.entityId !== sectionId ||
    !hasExactEntityIds(operation, [sectionId])
  ) {
    return undefined;
  }
  return {
    sectionId,
    taskId,
    workContextId,
    workContextType,
    workContextAfterTaskId,
  };
};

const getSectionOrder = (operation: Operation): SectionOrder | undefined => {
  if (
    operation.actionType !== ActionType.SECTION_UPDATE_ORDER ||
    operation.entityType !== 'SECTION' ||
    operation.opType !== OpType.Move
  ) {
    return undefined;
  }
  const payload = getActionPayload(operation);
  const contextId = payload?.['contextId'];
  const ids = payload?.['ids'];
  if (
    typeof contextId !== 'string' ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id): id is string => typeof id === 'string') ||
    operation.entityId !== ids[0] ||
    !hasExactEntityIds(operation, ids)
  ) {
    return undefined;
  }
  return { contextId, sectionIds: ids };
};

const isSectionOrderAndPlacementPair = (
  orderOperation: Operation,
  placementOperation: Operation,
): boolean => {
  const order = getSectionOrder(orderOperation);
  if (
    !order ||
    (!getSectionPlacement(placementOperation) && !getSectionRemoval(placementOperation))
  ) {
    return false;
  }
  return getOpEntityIds(placementOperation).some((id) => order.sectionIds.includes(id));
};

/**
 * Recognizes the narrow SECTION operation pairs whose reducer effects commute.
 * Metadata must exactly match the authenticated action payload before a pair is
 * allowed to bypass entity-level LWW.
 */
export const areCommutingSectionOperations = (
  first: Operation,
  second: Operation,
): boolean => {
  const firstMove = getSectionMove(first);
  const secondMove = getSectionMove(second);
  const firstRemoval = getSectionRemoval(first);
  const secondRemoval = getSectionRemoval(second);

  if (
    firstMove &&
    secondRemoval &&
    firstMove.sourceSectionId === secondRemoval.sectionId &&
    firstMove.taskId === secondRemoval.taskId
  ) {
    return true;
  }
  if (
    secondMove &&
    firstRemoval &&
    secondMove.sourceSectionId === firstRemoval.sectionId &&
    secondMove.taskId === firstRemoval.taskId
  ) {
    return true;
  }

  return (
    isSectionOrderAndPlacementPair(first, second) ||
    isSectionOrderAndPlacementPair(second, first)
  );
};

const withActionPayload = (
  operation: Operation,
  actionPayload: Record<string, unknown>,
): Operation => ({
  ...operation,
  payload: isMultiEntityPayload(operation.payload)
    ? { ...operation.payload, actionPayload, entityChanges: [] }
    : actionPayload,
});

const withEntityFootprint = (
  operation: Operation,
  entityIds: readonly string[],
): Operation => {
  const next = {
    ...operation,
    entityId: entityIds[0],
  };
  if (entityIds.length > 1) {
    next.entityIds = [...entityIds];
  } else {
    delete next.entityIds;
  }
  return next;
};

const getCurrentAnchor = (
  taskId: string,
  taskIds: readonly string[],
): { afterTaskId: string | null } | undefined => {
  const index = taskIds.indexOf(taskId);
  if (index === -1 || taskIds.lastIndexOf(taskId) !== index) {
    return undefined;
  }
  return { afterTaskId: index === 0 ? null : taskIds[index - 1] };
};

const getCurrentSectionsForTask = (state: SectionState, taskId: string): Section[] =>
  Object.values(state.entities).filter(
    (section): section is Section => !!section && section.taskIds.includes(taskId),
  );

const isSameWorkContext = (first: Section, second: Section): boolean =>
  first.contextId === second.contextId && first.contextType === second.contextType;

const getCurrentSectionsForTaskInContext = (
  state: SectionState,
  taskId: string,
  contextId: string,
  contextType: WorkContextType,
): Section[] =>
  getCurrentSectionsForTask(state, taskId).filter(
    (section) => section.contextId === contextId && section.contextType === contextType,
  );

const getWorkContextEntity = (
  snapshot: SectionReplaySnapshot,
  type: WorkContextType,
  id: string,
): Project | Tag | undefined =>
  type === WorkContextType.TAG
    ? snapshot.tag.entities[id]
    : snapshot.project.entities[id];

const createStateCompensation = (
  entityType: WorkContextType,
  entityId: string,
  entityState: Project | Tag,
): SectionReplayStateCompensation => {
  // Wire compatibility: v18.4.0-v18.4.3 accept schema-4 S6 rows but only
  // remove section membership; they ignore the later work-context anchor fields.
  // Their existing Project/Tag LWW reducer does understand this complete entity
  // snapshot, so persist it after semantic removals to converge taskIds ordering.
  return {
    entityType,
    entityId,
    entityState,
    order: {
      scope: getReplayScope('work-context-tasks', entityType, entityId),
      position: Number.MAX_SAFE_INTEGER,
    },
  };
};

const createPlacementReplay = (
  operation: Operation,
  placement: SectionPlacement,
  destination: Section,
): Operation => {
  const currentAnchor = getCurrentAnchor(placement.taskId, destination.taskIds);
  if (!currentAnchor) {
    return operation;
  }
  const entityIds =
    placement.sourceSectionId && placement.sourceSectionId !== destination.id
      ? [placement.sourceSectionId, destination.id]
      : [destination.id];
  return withEntityFootprint(
    withActionPayload(operation, {
      sectionId: destination.id,
      taskId: placement.taskId,
      afterTaskId: currentAnchor.afterTaskId,
      sourceSectionId: placement.sourceSectionId,
    }),
    entityIds,
  );
};

const createRemovalReplay = (
  operation: Operation,
  removal: SectionRemoval,
  afterTaskId: string | null,
): Operation =>
  withEntityFootprint(
    withActionPayload(
      {
        ...operation,
        actionType: ActionType.SECTION_REMOVE_TASK,
        opType: OpType.Update,
      },
      {
        sectionId: removal.sectionId,
        taskId: removal.taskId,
        workContextId: removal.workContextId,
        workContextType: removal.workContextType,
        workContextAfterTaskId: afterTaskId,
      },
    ),
    [removal.sectionId],
  );

/**
 * Projects a causally accepted SECTION intent onto the current, stable NgRx
 * frontier. The replacement is built from current ordering rather than a stale
 * anchor, so every already-applied local successor is represented without
 * action-family whitelists. A replay result must be a local no-op.
 */
export const projectSectionReplayAgainstState = (
  operation: Operation,
  snapshot: SectionReplaySnapshot,
): SectionReplayProjection => {
  const order = getSectionOrder(operation);
  if (order) {
    const currentIds = snapshot.section.ids.filter(
      (id) => snapshot.section.entities[id]?.contextId === order.contextId,
    );
    if (currentIds.length === 0) {
      return { kind: 'superseded' };
    }
    return {
      kind: 'replay',
      operation: withEntityFootprint(
        withActionPayload(operation, {
          contextId: order.contextId,
          ids: currentIds,
        }),
        currentIds,
      ),
      order: {
        scope: getReplayScope('section-order', order.contextId),
        position: 0,
      },
    };
  }

  const placement = getSectionPlacement(operation);
  if (placement) {
    const sourceSection = placement.sourceSectionId
      ? snapshot.section.entities[placement.sourceSectionId]
      : undefined;
    const destinationSection = snapshot.section.entities[placement.destinationSectionId];
    if (
      sourceSection &&
      destinationSection &&
      !isSameWorkContext(sourceSection, destinationSection)
    ) {
      return {
        kind: 'blocked',
        reason: 'source and destination sections belong to different work contexts',
      };
    }
    const contextSection = sourceSection ?? destinationSection;
    if (!contextSection) {
      return { kind: 'superseded' };
    }
    const currentSections = getCurrentSectionsForTaskInContext(
      snapshot.section,
      placement.taskId,
      contextSection.contextId,
      contextSection.contextType,
    );
    if (currentSections.length > 1) {
      return {
        kind: 'blocked',
        reason:
          `task ${placement.taskId} belongs to multiple sections in ` +
          `${contextSection.contextType}:${contextSection.contextId}`,
      };
    }
    if (currentSections.length === 1) {
      const destination = currentSections[0];
      const currentAnchor = getCurrentAnchor(placement.taskId, destination.taskIds);
      if (!currentAnchor) {
        return {
          kind: 'blocked',
          reason: `task ${placement.taskId} has ambiguous section ordering`,
        };
      }
      return {
        kind: 'replay',
        operation: createPlacementReplay(operation, placement, destination),
        order: {
          scope: getReplayScope(
            'section-tasks',
            destination.contextType,
            destination.contextId,
            destination.id,
          ),
          position: destination.taskIds.indexOf(placement.taskId),
        },
      };
    }

    const contextEntity = getWorkContextEntity(
      snapshot,
      contextSection.contextType,
      contextSection.contextId,
    );
    if (!contextEntity) {
      return { kind: 'superseded' };
    }
    const taskOccurrences = contextEntity.taskIds.filter(
      (id) => id === placement.taskId,
    ).length;
    if (taskOccurrences > 1) {
      return {
        kind: 'blocked',
        reason:
          `task ${placement.taskId} has ambiguous ordering in ` +
          `${contextSection.contextType}:${contextSection.contextId}`,
      };
    }
    const currentAnchor = getCurrentAnchor(placement.taskId, contextEntity.taskIds);
    if (!currentAnchor) {
      return { kind: 'superseded' };
    }
    return {
      kind: 'replay',
      operation: createRemovalReplay(
        operation,
        {
          sectionId: placement.sourceSectionId ?? placement.destinationSectionId,
          taskId: placement.taskId,
          workContextId: contextSection.contextId,
          workContextType: contextSection.contextType,
          workContextAfterTaskId: currentAnchor.afterTaskId,
        },
        currentAnchor.afterTaskId,
      ),
      order: {
        scope: getReplayScope(
          'work-context-tasks',
          contextSection.contextType,
          contextSection.contextId,
        ),
        position: contextEntity.taskIds.indexOf(placement.taskId),
      },
      stateCompensation: createStateCompensation(
        contextSection.contextType,
        contextSection.contextId,
        contextEntity,
      ),
    };
  }

  const removal = getSectionRemoval(operation);
  if (removal) {
    const sourceSection = snapshot.section.entities[removal.sectionId];
    if (
      sourceSection &&
      (sourceSection.contextId !== removal.workContextId ||
        sourceSection.contextType !== removal.workContextType)
    ) {
      return {
        kind: 'blocked',
        reason: `section ${removal.sectionId} does not belong to the declared work context`,
      };
    }
    const contextEntity = getWorkContextEntity(
      snapshot,
      removal.workContextType,
      removal.workContextId,
    );
    const sourceContainsTask = sourceSection?.taskIds.includes(removal.taskId) === true;
    if (!contextEntity) {
      return sourceContainsTask
        ? {
            kind: 'blocked',
            reason:
              `task ${removal.taskId} is sectioned but its declared work context ` +
              `${removal.workContextType}:${removal.workContextId} is missing`,
          }
        : { kind: 'superseded' };
    }
    const taskOccurrences = contextEntity.taskIds.filter(
      (id) => id === removal.taskId,
    ).length;
    if (taskOccurrences > 1) {
      return {
        kind: 'blocked',
        reason:
          `task ${removal.taskId} has ambiguous ordering in ` +
          `${removal.workContextType}:${removal.workContextId}`,
      };
    }
    const currentAnchor = getCurrentAnchor(removal.taskId, contextEntity.taskIds);
    if (sourceContainsTask) {
      if (!currentAnchor) {
        return {
          kind: 'blocked',
          reason:
            `task ${removal.taskId} is sectioned but missing from ` +
            `${removal.workContextType}:${removal.workContextId}`,
        };
      }
      return {
        kind: 'work-context-state',
        ...createStateCompensation(
          removal.workContextType,
          removal.workContextId,
          contextEntity,
        ),
      };
    }
    if (!currentAnchor) {
      return { kind: 'superseded' };
    }
    return {
      kind: 'replay',
      operation: createRemovalReplay(operation, removal, currentAnchor.afterTaskId),
      order: {
        scope: getReplayScope(
          'work-context-tasks',
          removal.workContextType,
          removal.workContextId,
        ),
        position: contextEntity.taskIds.indexOf(removal.taskId),
      },
      stateCompensation: createStateCompensation(
        removal.workContextType,
        removal.workContextId,
        contextEntity,
      ),
    };
  }

  return { kind: 'blocked', reason: 'operation is not a valid SECTION transition' };
};
