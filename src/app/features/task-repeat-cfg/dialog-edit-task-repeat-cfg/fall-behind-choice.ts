import type { TaskRepeatCfgCopy } from '../task-repeat-cfg.model';

/**
 * "If you fall behind" in the repeat dialog: one choice for what used to be two
 * checkboxes whose combination was invisible. Dialog-only; the stored fields
 * stay `waitForCompletion` and `skipOverdue`.
 */
export type FallBehindChoice = 'KEEP' | 'LATEST' | 'WAIT';

type FallBehindFields = Pick<TaskRepeatCfgCopy, 'waitForCompletion' | 'skipOverdue'>;

/**
 * Waiting is checked first when copies are created, so it decides what the
 * user sees. A legacy config with both flags shows as "Wait" and keeps both
 * until the user picks a choice.
 */
export const toFallBehindChoice = (cfg: FallBehindFields): FallBehindChoice =>
  cfg.waitForCompletion ? 'WAIT' : cfg.skipOverdue ? 'LATEST' : 'KEEP';

/**
 * "Wait" deliberately turns skipping off: waiting then means nothing silently
 * disappears and at most one copy is open. Dropping missed dates is "Only keep
 * the latest".
 */
export const fromFallBehindChoice = (
  choice: FallBehindChoice,
): Required<FallBehindFields> => {
  switch (choice) {
    case 'LATEST':
      return { waitForCompletion: false, skipOverdue: true };
    case 'WAIT':
      return { waitForCompletion: true, skipOverdue: false };
    case 'KEEP':
    default:
      return { waitForCompletion: false, skipOverdue: false };
  }
};
