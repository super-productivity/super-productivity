import { RepairSummary } from '../core/operation.types';

const REPAIR_SUMMARY_KEYS: readonly (keyof RepairSummary)[] = [
  'entityStateFixed',
  'orphanedEntitiesRestored',
  'invalidReferencesRemoved',
  'relationshipsFixed',
  'structureRepaired',
  'typeErrorsFixed',
];

/**
 * Reads a REPAIR payload's summary, or `undefined` when it is missing or any
 * count is not a finite, non-negative number.
 */
export const getRepairSummary = (payload: unknown): RepairSummary | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const summary = (payload as Record<string, unknown>)['repairSummary'];
  if (typeof summary !== 'object' || summary === null) {
    return undefined;
  }
  const summaryRecord = summary as Record<string, unknown>;
  if (
    !REPAIR_SUMMARY_KEYS.every(
      (key) =>
        typeof summaryRecord[key] === 'number' &&
        Number.isFinite(summaryRecord[key]) &&
        (summaryRecord[key] as number) >= 0,
    )
  ) {
    return undefined;
  }
  return summaryRecord as unknown as RepairSummary;
};
