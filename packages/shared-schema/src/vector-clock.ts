// Compatibility re-export. The single source of truth for generic vector-clock
// algorithms lives in @sp/sync-core.
export type { VectorClock, VectorClockComparison } from '@sp/sync-core';
export {
  compareVectorClocks,
  mergeVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from '@sp/sync-core';
