import { LS } from '../../core/persistence/storage-keys.const';
import { loadArmedIds, loadArmedTriggers, saveArmed } from './armed-reminder-store';

describe('armed-reminder-store', () => {
  const KEY = LS.MOBILE_ARMED_REMINDER_IDS;

  afterEach(() => localStorage.removeItem(KEY));

  it('round-trips ids', () => {
    saveArmed(KEY, new Set(['a', 'b']));
    expect(loadArmedIds(KEY)).toEqual(new Set(['a', 'b']));
  });

  it('round-trips ids with trigger times', () => {
    saveArmed(KEY, new Map([['a', 1000]]));
    expect(loadArmedTriggers(KEY)).toEqual(new Map([['a', 1000]]));
  });

  it('starts empty without a record', () => {
    expect(loadArmedIds(KEY).size).toBe(0);
    expect(loadArmedTriggers(KEY).size).toBe(0);
  });

  it('starts empty for an unreadable record', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadArmedIds(KEY).size).toBe(0);
  });

  it('drops malformed entries', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 1, ['b', 'x'], ['c', 5]]));
    expect(loadArmedIds(KEY)).toEqual(new Set(['a']));
    expect(loadArmedTriggers(KEY)).toEqual(new Map([['c', 5]]));
  });
});
