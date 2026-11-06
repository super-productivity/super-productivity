import {
  composeId,
  isPluginIdMatch,
} from '../../../plugins/util/plugin-persistence-key.util';
import {
  readTaskHistoryDelivery,
  TASK_HISTORY_DELIVERY_PREFIX,
} from './task-history-delivery';
import { TaskHistoryEnvelope } from './task-history.model';

describe('App-owned task history delivery namespace', () => {
  it('cannot collide with keyed writes or uninstall sweeps of a valid plugin', () => {
    const pluginId = 'sp-internal-task-history';
    const operationId = 'author-operation';
    const deliveryId = `${TASK_HISTORY_DELIVERY_PREFIX}${operationId}`;
    expect(composeId(pluginId, operationId)).not.toBe(deliveryId);
    expect(isPluginIdMatch(deliveryId, pluginId)).toBe(false);
    expect(
      readTaskHistoryDelivery({
        id: composeId(pluginId, operationId),
        data: 'plugin data',
      }),
    ).toBeUndefined();
    expect(() => composeId(':sp-internal-task-history', operationId)).toThrow();
  });

  it('still reads and validates the immutable app-owned envelope', () => {
    const envelope: TaskHistoryEnvelope = {
      version: 1,
      operationId: 'author-operation',
      occurredAt: 1,
      baselines: [],
      events: [],
    };
    const id = `${TASK_HISTORY_DELIVERY_PREFIX}${envelope.operationId}`;
    expect(
      readTaskHistoryDelivery({ pluginUserData: { id, data: JSON.stringify(envelope) } }),
    ).toEqual(envelope);
    expect(() => readTaskHistoryDelivery({ id, data: 'invalid' })).toThrow();
  });
});
