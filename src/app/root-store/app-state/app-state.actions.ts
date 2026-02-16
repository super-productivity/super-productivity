/* eslint-disable @typescript-eslint/naming-convention */
import { createActionGroup, props } from '@ngrx/store';

export const AppStateActions = createActionGroup({
  source: 'AppState',
  events: {
    'Set Today String': props<{ todayStr: string; startOfNextDayDiffMs: number }>(),
  },
});
