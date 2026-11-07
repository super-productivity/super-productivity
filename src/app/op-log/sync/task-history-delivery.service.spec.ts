import { TestBed } from '@angular/core/testing';
import { TaskHistoryDeliveryService } from './task-history-delivery.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { VectorClockService } from './vector-clock.service';
import { EntityConflict, Operation, ActionType, OpType } from '../core/operation.types';
import { collectTaskHistory } from '../../features/tasks/task-history/task-history.util';
import {
  readTaskHistoryDelivery,
  TASK_HISTORY_DELIVERY_PREFIX,
} from '../../features/tasks/task-history/task-history-delivery';
import { createStateWithExistingTasks } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { validateOperationPayload } from '../validation/validate-operation-payload';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

describe('TaskHistoryDeliveryService', () => {
  let service: TaskHistoryDeliveryService;
  const source = (id: string, day: string): Operation => {
    const before = createStateWithExistingTasks(['task1']).tasks;
    const after = {
      ...before,
      entities: { ...before.entities, task1: { ...before.entities.task1!, dueDay: day } },
    };
    return {
      id,
      clientId: id,
      timestamp: 100,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      vectorClock: { [id]: 1 },
      actionType: ActionType.TASK_SHARED_UPDATE,
      entityType: 'TASK',
      entityId: 'task1',
      opType: OpType.Update,
      payload: {
        actionPayload: {
          task: { id: 'task1', changes: { dueDay: day } },
          taskHistory: collectTaskHistory(
            before,
            after,
            id,
            100,
            ActionType.TASK_SHARED_UPDATE,
          ),
        },
        entityChanges: [],
      },
    };
  };
  const conflict = (localOps: Operation[], remoteOps: Operation[]): EntityConflict => ({
    entityType: 'TASK',
    entityId: 'task1',
    localOps,
    remoteOps,
    suggestedResolution: 'manual',
  });
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { getOrGenerateClientId: async () => 'resolver' },
        },
        {
          provide: VectorClockService,
          useValue: { getCurrentVectorClock: async () => ({ resolver: 4 }) },
        },
      ],
    });
    service = TestBed.inject(TaskHistoryDeliveryService);
  });

  it('preserves BOTH authors in ordinary opaque delivery records without task fields', async () => {
    const a = source('author-a', '2026-11-01');
    const b = source('author-b', '2026-11-02');
    const deliveries = await service.create([conflict([a], [b])]);
    expect(deliveries).toHaveSize(2);
    for (const op of deliveries) {
      expect(op.entityType).toBe('PLUGIN_USER_DATA');
      expect(op.actionType).toBe(ActionType.PLUGIN_UPSERT_USER_DATA);
      expect(validateOperationPayload(op).success).toBeTrue();
      const payload = (op.payload as { actionPayload: Record<string, unknown> })
        .actionPayload;
      expect(Object.keys(payload)).toEqual(['pluginUserData']);
      const envelope = readTaskHistoryDelivery(payload)!;
      expect(envelope.events[0].before).toEqual({ kind: 'none' });
      expect(envelope.events[0].operationId).toBe(envelope.operationId);
      expect(op.entityId).toBe(`${TASK_HISTORY_DELIVERY_PREFIX}${envelope.operationId}`);
      expect(op.vectorClock['author-a']).toBe(1);
      expect(op.vectorClock['author-b']).toBe(1);
      expect(op.vectorClock.resolver).toBeGreaterThan(4);
    }
    expect(
      deliveries.map(
        (op) =>
          readTaskHistoryDelivery(
            (op.payload as { actionPayload: unknown }).actionPayload,
          )!.events[0].after,
      ),
    ).toEqual([
      { kind: 'day', value: '2026-11-01' },
      { kind: 'day', value: '2026-11-02' },
    ]);
  });

  it('does not create more deliveries when a delivery record itself conflicts', async () => {
    const first = await service.create([
      conflict([source('author-a', '2026-11-01')], []),
    ]);
    expect(await service.create([conflict(first, first)])).toEqual([]);
  });

  it('deduplicates a source operation listed in several conflict scopes', async () => {
    const op = source('author-a', '2026-11-01');
    expect(await service.create([conflict([op], [op]), conflict([op], [])])).toHaveSize(
      1,
    );
  });

  it('leaves legacy operations without an author history untouched', async () => {
    const op = source('legacy', '2026-11-01');
    delete (op.payload as { actionPayload: Record<string, unknown> }).actionPayload
      .taskHistory;
    expect(await service.create([conflict([op], [])])).toEqual([]);
  });

  it('rejects a corrupted delivery instead of accepting invented history', () => {
    expect(() =>
      readTaskHistoryDelivery({
        pluginUserData: { id: `${TASK_HISTORY_DELIVERY_PREFIX}bad`, data: '{}' },
      }),
    ).toThrow();
    expect(
      readTaskHistoryDelivery({ pluginUserData: { id: 'other-plugin:key', data: '{}' } }),
    ).toBeUndefined();
  });
});
