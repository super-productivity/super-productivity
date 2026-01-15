import {
  TimeTrackingActions,
  updateWorkContextData,
  syncTimeTracking,
} from './time-tracking.actions';
import { createFeature, createReducer, on } from '@ngrx/store';
import { TimeTrackingState } from '../time-tracking.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { roundTsToMinutes } from '../../../util/round-ts-to-minutes';
import { TODAY_TAG } from '../../tag/tag.const';

export const TIME_TRACKING_FEATURE_KEY = 'timeTracking' as const;

// export const initialTimeTrackingState: TimeTrackingState = {
export const initialTimeTrackingState: TimeTrackingState = {
  tag: {},
  project: {},
  // lastFlush: 0,
} as const;

export const timeTrackingReducer = createReducer(
  initialTimeTrackingState,

  on(loadAllData, (state, { appDataComplete }) =>
    (appDataComplete as AppDataComplete).timeTracking
      ? (appDataComplete as AppDataComplete).timeTracking
      : state,
  ),
  on(TimeTrackingActions.updateWholeState, (state, { newState }) => newState),

  on(TimeTrackingActions.addTimeSpent, (state, { task, date }) => {
    const isUpdateProject = !!task.projectId;

    return {
      ...state,
      ...(isUpdateProject
        ? {
            project: {
              ...state.project,
              [task.projectId]: {
                ...state.project[task.projectId],
                [date]: {
                  ...state.project[task.projectId]?.[date],
                  e: roundTsToMinutes(Date.now()),
                  s: roundTsToMinutes(
                    state.project[task.projectId]?.[date]?.s || Date.now(),
                  ),
                },
              },
            },
          }
        : {}),
      tag: {
        ...state.tag,
        ...([TODAY_TAG.id, ...(task.tagIds || [])] as string[]).reduce((acc, tagId) => {
          acc[tagId] = {
            ...state.tag[tagId],
            [date]: {
              ...state.tag[tagId]?.[date],
              e: roundTsToMinutes(Date.now()),
              s: roundTsToMinutes(state.tag[tagId]?.[date]?.s || Date.now()),
            },
          };
          return acc;
        }, {}),
      },
    };
  }),

  on(updateWorkContextData, (state, { ctx, date, updates }) => {
    const prop = ctx.type === 'TAG' ? 'tag' : 'project';

    return {
      ...state,
      [prop]: {
        ...state[prop],
        [ctx.id]: {
          ...(state[prop]?.[ctx.id] || {}),
          [date]: {
            ...(state[prop]?.[ctx.id]?.[date] || {}),
            ...updates,
          },
        },
      },
    };
  }),

  on(syncTimeTracking, (state, { contextType, contextId, date, data }) => {
    const prop = contextType === 'TAG' ? 'tag' : 'project';

    return {
      ...state,
      [prop]: {
        ...state[prop],
        [contextId]: {
          ...(state[prop]?.[contextId] || {}),
          [date]: data,
        },
      },
    };
  }),
);

export const timeTrackingFeature = createFeature({
  name: TIME_TRACKING_FEATURE_KEY,
  reducer: timeTrackingReducer,
});
