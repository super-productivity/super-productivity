import { AppDataCompleteLegacy } from '../../imex/sync/sync.model';
import { AppDataComplete } from '../model/model-config';

export const isDataRepairPossible = (
  data: AppDataCompleteLegacy | AppDataComplete,
): boolean => {
  if (typeof data !== 'object' || data === null) return false;

  // Use 'in' operator for safe property checks without any cast
  const hasTask = 'task' in data && typeof data.task === 'object' && data.task !== null;
  const hasProject =
    'project' in data && typeof data.project === 'object' && data.project !== null;

  return hasTask && hasProject;
};
