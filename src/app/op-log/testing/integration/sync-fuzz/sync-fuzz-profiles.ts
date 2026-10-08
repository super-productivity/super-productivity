import { DEFAULT_WEIGHTS, IntentWeights, REPLACEMENT_WEIGHTS } from './sync-fuzz-actions';

/**
 * Intent mixes of the random-seed runs. `noReorder` leaves out the reorder
 * wedge, a stop that masks every later failure on the stopped device; `tasks`
 * concentrates on task edits crossing tracked time; `replace` adds the state
 * replacements the UI offers (force upload, backup export and import) and
 * answers the SYNC_IMPORT conflict dialog. Every mix answers the
 * whole-dataset dialog after a stop, with a `k` stream of its own outside
 * `replace`. A new mix leaves the other mixes' traces unchanged.
 */
export const FUZZ_PROFILES: Record<string, IntentWeights> = {
  all: DEFAULT_WEIGHTS,
  noReorder: DEFAULT_WEIGHTS.filter(
    ([kind]) => kind !== 'reorderNotes' && kind !== 'reorderHabits',
  ),
  tasks: [
    ['renameTask', 3],
    ['editTaskNotes', 2],
    ['track', 4],
    ['doneTask', 1],
  ],
  replace: REPLACEMENT_WEIGHTS,
};
