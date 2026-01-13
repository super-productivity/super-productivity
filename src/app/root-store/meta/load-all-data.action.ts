import { createAction, props } from '@ngrx/store';
import { AppDataCompleteLegacy } from '../../imex/sync/sync.model';
import { AppDataComplete } from '../../op-log/model/model-config';

export const loadAllData = createAction(
  '[SP_ALL] Load(import) all data',
  props<{
    appDataComplete: AppDataCompleteLegacy | AppDataComplete;
  }>(),
);
