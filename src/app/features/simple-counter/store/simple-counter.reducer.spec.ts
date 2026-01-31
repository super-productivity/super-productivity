/* eslint-disable @typescript-eslint/naming-convention */
import {
  simpleCounterReducer,
  initialSimpleCounterState,
} from './simple-counter.reducer';
import * as SimpleCounterActions from './simple-counter.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import {
  SimpleCounter,
  SimpleCounterState,
  SimpleCounterType,
} from '../simple-counter.model';
import { EMPTY_SIMPLE_COUNTER, DEFAULT_SIMPLE_COUNTERS } from '../simple-counter.const';
import { AppDataCompleteLegacy } from '../../../imex/sync/sync.model';
import { OpType } from '../../../op-log/core/operation.types';

const createCounter = (
  id: string,
  partial: Partial<SimpleCounter> = {},
): SimpleCounter => ({
  ...EMPTY_SIMPLE_COUNTER,
  id,
  title: `Counter ${id}`,
  isEnabled: true,
  ...partial,
});

const createStateWithCounters = (counters: SimpleCounter[]): SimpleCounterState => ({
  ids: counters.map((c) => c.id),
  entities: counters.reduce(
    (acc, c) => {
      acc[c.id] = c;
      return acc;
    },
    {} as Record<string, SimpleCounter>,
  ),
});

describe('SimpleCounterReducer', () => {
  describe('initial state', () => {
    it('should have DEFAULT_SIMPLE_COUNTERS on initialization', () => {
      const action = { type: 'UNKNOWN' };
      const result = simpleCounterReducer(undefined, action);

      expect(result.ids.length).toBe(DEFAULT_SIMPLE_COUNTERS.length);
      DEFAULT_SIMPLE_COUNTERS.forEach((counter) => {
        expect(result.ids).toContain(counter.id);
        expect(result.entities[counter.id]).toEqual(counter);
      });
    });

    it('should have correct ids array matching DEFAULT_SIMPLE_COUNTERS', () => {
      const result = simpleCounterReducer(undefined, { type: 'UNKNOWN' });
      const expectedIds = DEFAULT_SIMPLE_COUNTERS.map((c) => c.id);

      expect(result.ids).toEqual(expectedIds);
    });
  });

  describe('loadAllData', () => {
    it('should disable isOn for all counters when loading', () => {
      const counters: SimpleCounter[] = [
        createCounter('counter1', { isOn: true }),
        createCounter('counter2', { isOn: true }),
      ];
      const simpleCounterState = createStateWithCounters(counters);
      const appDataComplete = {
        simpleCounter: simpleCounterState,
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = simpleCounterReducer(initialSimpleCounterState, action);

      expect(result.entities['counter1']!.isOn).toBe(false);
      expect(result.entities['counter2']!.isOn).toBe(false);
    });

    it('should preserve other counter properties when disabling isOn', () => {
      const counter = createCounter('counter1', {
        isOn: true,
        title: 'My Counter',
        countOnDay: { '2024-01-01': 5 },
      });
      const simpleCounterState = createStateWithCounters([counter]);
      const appDataComplete = {
        simpleCounter: simpleCounterState,
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = simpleCounterReducer(initialSimpleCounterState, action);

      expect(result.entities['counter1']!.title).toBe('My Counter');
      expect(result.entities['counter1']!.countOnDay).toEqual({ '2024-01-01': 5 });
    });

    it('should preserve state when simpleCounter is undefined', () => {
      const appDataComplete = {
        simpleCounter: undefined,
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = simpleCounterReducer(initialSimpleCounterState, action);

      expect(result).toBe(initialSimpleCounterState);
    });
  });

  describe('updateAllSimpleCounters', () => {
    it('should add new counters not in current state', () => {
      const existingCounter = createCounter('existing');
      const existingState = createStateWithCounters([existingCounter]);
      const newCounter = createCounter('new-counter');

      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [existingCounter, newCounter],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toContain('new-counter');
      expect(result.entities['new-counter']).toEqual(newCounter);
    });

    it('should remove counters not in new items list', () => {
      const counter1 = createCounter('counter1');
      const counter2 = createCounter('counter2');
      const existingState = createStateWithCounters([counter1, counter2]);

      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [counter1],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).not.toContain('counter2');
      expect(result.entities['counter2']).toBeUndefined();
    });

    it('should upsert existing counters with new data', () => {
      const existingCounter = createCounter('counter1', { title: 'Old Title' });
      const existingState = createStateWithCounters([existingCounter]);
      const updatedCounter = createCounter('counter1', { title: 'New Title' });

      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [updatedCounter],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['counter1']!.title).toBe('New Title');
    });

    it('should handle empty items list by removing all counters', () => {
      const counter = createCounter('counter1');
      const existingState = createStateWithCounters([counter]);

      const action = SimpleCounterActions.updateAllSimpleCounters({ items: [] });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toEqual([]);
      expect(result.entities).toEqual({});
    });

    it('should preserve order when items are reordered', () => {
      const counter1 = createCounter('counter1');
      const counter2 = createCounter('counter2');
      const counter3 = createCounter('counter3');
      const existingState = createStateWithCounters([counter1, counter2, counter3]);

      // Reorder: move counter1 to the end
      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [counter2, counter3, counter1],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toEqual(['counter2', 'counter3', 'counter1']);
    });

    it('should preserve order when items are swapped', () => {
      const counter1 = createCounter('counter1');
      const counter2 = createCounter('counter2');
      const existingState = createStateWithCounters([counter1, counter2]);

      // Swap order
      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [counter2, counter1],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toEqual(['counter2', 'counter1']);
    });

    it('should handle duplicate items in input by using unique IDs only', () => {
      const counter1 = createCounter('counter1');
      const counter2 = createCounter('counter2');
      const existingState = createStateWithCounters([counter1, counter2]);

      // Pass duplicate items - should still produce unique ids array
      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [counter1, counter2, counter1],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toEqual(['counter1', 'counter2']);
    });

    it('should preserve order when adding new items at specific positions', () => {
      const counter1 = createCounter('counter1');
      const counter2 = createCounter('counter2');
      const existingState = createStateWithCounters([counter1, counter2]);
      const newCounter = createCounter('new-counter');

      // Add new item in the middle
      const action = SimpleCounterActions.updateAllSimpleCounters({
        items: [counter1, newCounter, counter2],
      });
      const result = simpleCounterReducer(existingState, action);

      expect(result.ids).toEqual(['counter1', 'new-counter', 'counter2']);
    });
  });

  describe('set count operations', () => {
    describe('setSimpleCounterCounterToday', () => {
      it('should update countOnDay for today', () => {
        const counter = createCounter('counter1', { countOnDay: {} });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 10,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(10);
      });

      it('should preserve other date entries', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-14': 5 },
        });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 10,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-14']).toBe(5);
        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(10);
      });
    });

    describe('setSimpleCounterCounterForDate', () => {
      it('should update countOnDay for specified date', () => {
        const counter = createCounter('counter1', { countOnDay: {} });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterForDate({
          id: 'counter1',
          date: '2024-01-10',
          newVal: 7,
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-10']).toBe(7);
      });
    });
  });

  describe('increase/decrease operations', () => {
    describe('increaseSimpleCounterCounterToday', () => {
      it('should increment from 0 if no entry exists', () => {
        const counter = createCounter('counter1', { countOnDay: {} });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.increaseSimpleCounterCounterToday({
          id: 'counter1',
          increaseBy: 5,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(5);
      });

      it('should increment existing value', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 10 },
        });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.increaseSimpleCounterCounterToday({
          id: 'counter1',
          increaseBy: 3,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(13);
      });
    });

    describe('decreaseSimpleCounterCounterToday', () => {
      it('should decrement existing value', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 10 },
        });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.decreaseSimpleCounterCounterToday({
          id: 'counter1',
          decreaseBy: 3,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(7);
      });

      it('should not go below 0 (Math.max boundary)', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 5 },
        });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.decreaseSimpleCounterCounterToday({
          id: 'counter1',
          decreaseBy: 10,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(0);
      });

      it('should result in 0 when no entry exists', () => {
        const counter = createCounter('counter1', { countOnDay: {} });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.decreaseSimpleCounterCounterToday({
          id: 'counter1',
          decreaseBy: 5,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(0);
      });
    });
  });

  describe('toggle operations', () => {
    describe('toggleSimpleCounterCounter', () => {
      it('should toggle isOn from false to true', () => {
        const counter = createCounter('counter1', { isOn: false });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.toggleSimpleCounterCounter({
          id: 'counter1',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.isOn).toBe(true);
      });

      it('should toggle isOn from true to false', () => {
        const counter = createCounter('counter1', { isOn: true });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.toggleSimpleCounterCounter({
          id: 'counter1',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.isOn).toBe(false);
      });
    });

    describe('setSimpleCounterCounterOn', () => {
      it('should set isOn to true', () => {
        const counter = createCounter('counter1', { isOn: false });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterOn({ id: 'counter1' });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.isOn).toBe(true);
      });

      it('should remain true if already true', () => {
        const counter = createCounter('counter1', { isOn: true });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterOn({ id: 'counter1' });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.isOn).toBe(true);
      });
    });

    describe('setSimpleCounterCounterOff', () => {
      it('should set isOn to false', () => {
        const counter = createCounter('counter1', { isOn: true });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.setSimpleCounterCounterOff({
          id: 'counter1',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.isOn).toBe(false);
      });
    });
  });

  describe('CRUD operations', () => {
    describe('addSimpleCounter', () => {
      it('should add new counter to state', () => {
        const existingState = createStateWithCounters([]);
        const newCounter = createCounter('new-counter');

        const action = SimpleCounterActions.addSimpleCounter({
          simpleCounter: newCounter,
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.ids).toContain('new-counter');
        expect(result.entities['new-counter']).toEqual(newCounter);
      });
    });

    describe('updateSimpleCounter', () => {
      it('should update existing counter', () => {
        const counter = createCounter('counter1', { title: 'Old' });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.updateSimpleCounter({
          simpleCounter: {
            id: 'counter1',
            changes: { title: 'New' },
          },
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.title).toBe('New');
      });
    });

    describe('upsertSimpleCounter', () => {
      it('should add counter if not exists', () => {
        const existingState = createStateWithCounters([]);
        const newCounter = createCounter('new-counter');

        const action = SimpleCounterActions.upsertSimpleCounter({
          simpleCounter: newCounter,
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.ids).toContain('new-counter');
      });

      it('should update counter if exists', () => {
        const counter = createCounter('counter1', { title: 'Old' });
        const existingState = createStateWithCounters([counter]);
        const updatedCounter = createCounter('counter1', { title: 'New' });

        const action = SimpleCounterActions.upsertSimpleCounter({
          simpleCounter: updatedCounter,
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.title).toBe('New');
      });
    });

    describe('deleteSimpleCounter', () => {
      it('should remove counter by id', () => {
        const counter1 = createCounter('counter1');
        const counter2 = createCounter('counter2');
        const existingState = createStateWithCounters([counter1, counter2]);

        const action = SimpleCounterActions.deleteSimpleCounter({ id: 'counter1' });
        const result = simpleCounterReducer(existingState, action);

        expect(result.ids).not.toContain('counter1');
        expect(result.entities['counter1']).toBeUndefined();
        expect(result.ids).toContain('counter2');
      });
    });

    describe('deleteSimpleCounters', () => {
      it('should remove multiple counters by ids', () => {
        const counter1 = createCounter('counter1');
        const counter2 = createCounter('counter2');
        const counter3 = createCounter('counter3');
        const existingState = createStateWithCounters([counter1, counter2, counter3]);

        const action = SimpleCounterActions.deleteSimpleCounters({
          ids: ['counter1', 'counter2'],
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.ids).not.toContain('counter1');
        expect(result.ids).not.toContain('counter2');
        expect(result.ids).toContain('counter3');
      });
    });
  });

  describe('turnOffAllSimpleCounterCounters', () => {
    it('should turn off all StopWatch counters that are isOn', () => {
      const stopWatch1 = createCounter('sw1', {
        type: SimpleCounterType.StopWatch,
        isOn: true,
      });
      const stopWatch2 = createCounter('sw2', {
        type: SimpleCounterType.StopWatch,
        isOn: true,
      });
      const existingState = createStateWithCounters([stopWatch1, stopWatch2]);

      const action = SimpleCounterActions.turnOffAllSimpleCounterCounters();
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['sw1']!.isOn).toBe(false);
      expect(result.entities['sw2']!.isOn).toBe(false);
    });

    it('should NOT affect ClickCounter types', () => {
      const clickCounter = createCounter('cc1', {
        type: SimpleCounterType.ClickCounter,
        isOn: true,
      });
      const existingState = createStateWithCounters([clickCounter]);

      const action = SimpleCounterActions.turnOffAllSimpleCounterCounters();
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['cc1']!.isOn).toBe(true);
    });

    it('should NOT affect RepeatedCountdownReminder types', () => {
      const reminder = createCounter('rcr1', {
        type: SimpleCounterType.RepeatedCountdownReminder,
        isOn: true,
      });
      const existingState = createStateWithCounters([reminder]);

      const action = SimpleCounterActions.turnOffAllSimpleCounterCounters();
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['rcr1']!.isOn).toBe(true);
    });

    it('should NOT affect already off StopWatch counters', () => {
      const stopWatch = createCounter('sw1', {
        type: SimpleCounterType.StopWatch,
        isOn: false,
      });
      const existingState = createStateWithCounters([stopWatch]);

      const action = SimpleCounterActions.turnOffAllSimpleCounterCounters();
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['sw1']!.isOn).toBe(false);
    });

    it('should preserve other counter properties when turning off', () => {
      const stopWatch = createCounter('sw1', {
        type: SimpleCounterType.StopWatch,
        isOn: true,
        title: 'My StopWatch',
        countOnDay: { '2024-01-15': 1000 },
      });
      const existingState = createStateWithCounters([stopWatch]);

      const action = SimpleCounterActions.turnOffAllSimpleCounterCounters();
      const result = simpleCounterReducer(existingState, action);

      expect(result.entities['sw1']!.title).toBe('My StopWatch');
      expect(result.entities['sw1']!.countOnDay).toEqual({ '2024-01-15': 1000 });
    });
  });

  describe('action persistence metadata', () => {
    describe('updateAllSimpleCounters', () => {
      it('should have isPersistent: true', () => {
        const action = SimpleCounterActions.updateAllSimpleCounters({ items: [] });

        expect(action.meta).toBeDefined();
        expect(action.meta.isPersistent).toBe(true);
      });

      it('should have correct entityType', () => {
        const action = SimpleCounterActions.updateAllSimpleCounters({ items: [] });

        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
      });

      it('should have Update opType', () => {
        const action = SimpleCounterActions.updateAllSimpleCounters({ items: [] });

        expect(action.meta.opType).toBe(OpType.Update);
      });

      it('should include items in payload', () => {
        const counter = createCounter('test-counter');
        const action = SimpleCounterActions.updateAllSimpleCounters({ items: [counter] });

        expect(action.items).toEqual([counter]);
      });
    });

    describe('addSimpleCounter', () => {
      it('should have isPersistent: true', () => {
        const counter = createCounter('test-counter');
        const action = SimpleCounterActions.addSimpleCounter({ simpleCounter: counter });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityId).toBe('test-counter');
        expect(action.meta.opType).toBe(OpType.Create);
      });
    });

    describe('updateSimpleCounter', () => {
      it('should have isPersistent: true', () => {
        const action = SimpleCounterActions.updateSimpleCounter({
          simpleCounter: { id: 'test-counter', changes: { title: 'New' } },
        });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityId).toBe('test-counter');
        expect(action.meta.opType).toBe(OpType.Update);
      });
    });

    describe('deleteSimpleCounter', () => {
      it('should have isPersistent: true', () => {
        const action = SimpleCounterActions.deleteSimpleCounter({ id: 'test-counter' });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityId).toBe('test-counter');
        expect(action.meta.opType).toBe(OpType.Delete);
      });
    });

    describe('deleteSimpleCounters', () => {
      it('should have isPersistent: true with bulk flag', () => {
        const action = SimpleCounterActions.deleteSimpleCounters({
          ids: ['counter1', 'counter2'],
        });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityIds).toEqual(['counter1', 'counter2']);
        expect(action.meta.opType).toBe(OpType.Delete);
        expect(action.meta.isBulk).toBe(true);
      });
    });

    describe('upsertSimpleCounter', () => {
      it('should NOT have isPersistent (used for sync/import)', () => {
        const counter = createCounter('test-counter');
        const action = SimpleCounterActions.upsertSimpleCounter({
          simpleCounter: counter,
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('turnOffAllSimpleCounterCounters', () => {
      it('should NOT have isPersistent (internal cleanup)', () => {
        const action = SimpleCounterActions.turnOffAllSimpleCounterCounters() as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('setSimpleCounterCounterToday', () => {
      it('should have isPersistent: true', () => {
        const action = SimpleCounterActions.setSimpleCounterCounterToday({
          id: 'counter1',
          newVal: 5,
          today: '2024-01-15',
        });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityId).toBe('counter1');
      });
    });

    // Note: toggleSimpleCounterCounter is intentionally non-persistent
    // isOn state should not sync across devices

    describe('increaseSimpleCounterCounterToday', () => {
      it('should NOT have isPersistent (local UI update, sync via setSimpleCounterCounterToday)', () => {
        const action = SimpleCounterActions.increaseSimpleCounterCounterToday({
          id: 'counter1',
          increaseBy: 1,
          today: '2024-01-15',
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('decreaseSimpleCounterCounterToday', () => {
      it('should NOT have isPersistent (local UI update, sync via setSimpleCounterCounterToday)', () => {
        const action = SimpleCounterActions.decreaseSimpleCounterCounterToday({
          id: 'counter1',
          decreaseBy: 1,
          today: '2024-01-15',
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('tickSimpleCounterLocal', () => {
      it('should NOT have isPersistent (local UI update only)', () => {
        const action = SimpleCounterActions.tickSimpleCounterLocal({
          id: 'counter1',
          increaseBy: 1000,
          today: '2024-01-15',
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('syncSimpleCounterTime', () => {
      it('should have isPersistent: true', () => {
        const action = SimpleCounterActions.syncSimpleCounterTime({
          id: 'counter1',
          date: '2024-01-15',
          duration: 5000,
        });

        expect(action.meta.isPersistent).toBe(true);
        expect(action.meta.entityType).toBe('SIMPLE_COUNTER');
        expect(action.meta.entityId).toBe('counter1');
        expect(action.meta.opType).toBe(OpType.Update);
      });
    });

    describe('setSimpleCounterCounterOn', () => {
      it('should NOT have isPersistent (isOn state is local only)', () => {
        const action = SimpleCounterActions.setSimpleCounterCounterOn({
          id: 'counter1',
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });

    describe('setSimpleCounterCounterOff', () => {
      it('should NOT have isPersistent (isOn state is local only)', () => {
        const action = SimpleCounterActions.setSimpleCounterCounterOff({
          id: 'counter1',
        }) as any;

        expect(action.meta).toBeUndefined();
      });
    });
  });

  describe('StopWatch sync (batched)', () => {
    describe('tickSimpleCounterLocal', () => {
      it('should increment countOnDay for today', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 5000 },
        });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.tickSimpleCounterLocal({
          id: 'counter1',
          increaseBy: 1000,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(6000);
      });

      it('should start from 0 if no entry exists', () => {
        const counter = createCounter('counter1', { countOnDay: {} });
        const existingState = createStateWithCounters([counter]);

        const action = SimpleCounterActions.tickSimpleCounterLocal({
          id: 'counter1',
          increaseBy: 1000,
          today: '2024-01-15',
        });
        const result = simpleCounterReducer(existingState, action);

        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(1000);
      });
    });

    describe('syncSimpleCounterTime', () => {
      it('should skip for local actions (state already updated by tick)', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 10000 },
        });
        const existingState = createStateWithCounters([counter]);

        // Local dispatch (no isRemote flag)
        const action = SimpleCounterActions.syncSimpleCounterTime({
          id: 'counter1',
          date: '2024-01-15',
          duration: 5000,
        });
        const result = simpleCounterReducer(existingState, action);

        // Should NOT apply - state unchanged
        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(10000);
      });

      it('should apply duration for remote actions', () => {
        const counter = createCounter('counter1', {
          countOnDay: { '2024-01-15': 10000 },
        });
        const existingState = createStateWithCounters([counter]);

        // Remote dispatch with isRemote flag
        const action = {
          ...SimpleCounterActions.syncSimpleCounterTime({
            id: 'counter1',
            date: '2024-01-15',
            duration: 5000,
          }),
          meta: {
            isPersistent: true,
            entityType: 'SIMPLE_COUNTER',
            entityId: 'counter1',
            opType: OpType.Update,
            isRemote: true,
          },
        };
        const result = simpleCounterReducer(existingState, action);

        // Should apply duration
        expect(result.entities['counter1']!.countOnDay['2024-01-15']).toBe(15000);
      });

      it('should handle missing counter gracefully for remote', () => {
        const existingState = createStateWithCounters([]);

        const action = {
          ...SimpleCounterActions.syncSimpleCounterTime({
            id: 'nonexistent',
            date: '2024-01-15',
            duration: 5000,
          }),
          meta: {
            isPersistent: true,
            entityType: 'SIMPLE_COUNTER',
            entityId: 'nonexistent',
            opType: OpType.Update,
            isRemote: true,
          },
        };
        const result = simpleCounterReducer(existingState, action);

        // Should return state unchanged
        expect(result).toBe(existingState);
      });
    });
  });
});
