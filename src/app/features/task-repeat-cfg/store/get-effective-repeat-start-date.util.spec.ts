import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';

describe('getEffectiveRepeatStartDate', () => {
  it('should return lastTaskCreationDay if repeatOnComplete is true and lastTaskCreationDay is set', () => {
    const cfg = {
      repeatFromCompletionDate: true,
      lastTaskCreationDay: '2025-08-01',
      startDate: '2022-01-01',
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('2025-08-01');
  });

  it('should return startDate if repeatOnComplete is true and startDate is later than lastTaskCreationDay (#11266)', () => {
    const cfg = {
      repeatFromCompletionDate: true,
      lastTaskCreationDay: '2026-05-01',
      startDate: '2026-05-11',
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('2026-05-11');
  });

  it('should return startDate if repeatOnComplete is true but lastTaskCreationDay is not set', () => {
    const cfg = {
      repeatFromCompletionDate: true,
      startDate: '2023-03-10',
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('2023-03-10');
  });

  it('should return startDate if repeatOnComplete is false even if lastTaskCreationDay is set', () => {
    const cfg = {
      repeatFromCompletionDate: false,
      lastTaskCreationDay: '2025-08-01',
      startDate: '2024-04-20',
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('2024-04-20');
  });

  it('should fall back to the epoch date when neither startDate nor (repeatOnComplete && lastTaskCreationDay) are set', () => {
    const cfg = {
      repeatFromCompletionDate: false,
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('1970-01-01');
  });

  it('should ignore lastTaskCreationDay when repeatOnComplete is false and no startDate is set (falls back to epoch)', () => {
    const cfg = {
      repeatFromCompletionDate: false,
      lastTaskCreationDay: '2025-09-09',
    } as TaskRepeatCfg;

    const result = getEffectiveRepeatStartDate(cfg);
    expect(result).toBe('1970-01-01');
  });
});
