import { inject, Injectable, Injector } from '@angular/core';
import {
  EntityConflict,
  Operation,
  extractActionPayload,
  OpType,
  ActionType,
} from '../core/operation.types';
import { TaskHistoryEnvelope } from '../../features/tasks/task-history/task-history.model';
import { TASK_HISTORY_DELIVERY_PREFIX } from '../../features/tasks/task-history/task-history-delivery';
import { isTaskHistoryEnvelope } from '../../features/tasks/task-history/task-history.validation';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { VectorClockService } from './vector-clock.service';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

@Injectable({ providedIn: 'root' })
export class TaskHistoryDeliveryService {
  private readonly _injector = inject(Injector);

  /**
   * Resolution can reject an unsynced author's task operation. Preserve its
   * audit facts in the SAME durable resolution batch before rejection. These
   * records have independent conflict keys and never reapply task values.
   */
  async create(conflicts: readonly EntityConflict[]): Promise<Operation[]> {
    const envelopes = new Map<string, TaskHistoryEnvelope>();
    const sources = conflicts.flatMap((conflict) => [
      ...conflict.localOps,
      ...conflict.remoteOps,
    ]);
    for (const op of sources) {
      // Delivery records themselves must never produce another delivery loop.
      if (op.entityType === 'PLUGIN_USER_DATA') continue;
      const value = extractActionPayload(op.payload)['taskHistory'];
      if (isTaskHistoryEnvelope(value)) envelopes.set(value.operationId, value);
    }
    if (!envelopes.size) return [];
    const clientId = await this._injector.get(CLIENT_ID_PROVIDER).getOrGenerateClientId();
    let clock = await this._injector.get(VectorClockService).getCurrentVectorClock();
    for (const op of sources) clock = mergeVectorClocks(clock, op.vectorClock);
    const timestamp = Date.now();
    return [...envelopes.values()].map((envelope) => {
      clock = incrementVectorClock(clock, clientId);
      const id = `${TASK_HISTORY_DELIVERY_PREFIX}${envelope.operationId}`;
      return {
        id: uuidv7(),
        actionType: ActionType.PLUGIN_UPSERT_USER_DATA,
        entityType: 'PLUGIN_USER_DATA',
        entityId: id,
        opType: OpType.Update,
        clientId,
        vectorClock: clock,
        timestamp,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        payload: {
          actionPayload: { pluginUserData: { id, data: JSON.stringify(envelope) } },
          entityChanges: [],
        },
      };
    });
  }
}
