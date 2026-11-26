import {
  TimeTrackingActions,
  updateWorkContextData,
  syncTimeTracking,
} from './time-tracking.actions';
import { createFeature, createReducer, on } from '@ngrx/store';
import { TimeTrackingState, TTWorkContextData } from '../time-tracking.model';
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

  on(TimeTrackingActions.addTimeSpent, (state, { task, date, isBackfill }) => {
    // Back-filled time for a past day was not worked now: stamping Date.now()
    // as that day's work end (or start) would be wrong.
    if (isBackfill) {
      return state;
    }
    const now = Date.now();
    const e = roundTsToMinutes(now);
    const startOf = (entry?: TTWorkContextData): number =>
      roundTsToMinutes(entry?.s || now);
    const stamp = (entry?: TTWorkContextData): TTWorkContextData => ({
      ...entry,
      e,
      s: startOf(entry),
    });
    // Whether stamp() would leave the entry as it is.
    const isStamped = (entry?: TTWorkContextData): boolean =>
      !!entry && entry.e === e && entry.s === startOf(entry);
    const tagIds = [TODAY_TAG.id, ...(task.tagIds || [])] as string[];

    // Start/end are minute-rounded, so this per-second tick changes them at most
    // once a minute. Keep the state reference otherwise, so selectors built on it
    // (e.g. the archive merge behind TimeTrackingService.state$) don't recompute
    // every second while tracking.
    if (
      (!task.projectId || isStamped(state.project[task.projectId]?.[date])) &&
      tagIds.every((tagId) => isStamped(state.tag[tagId]?.[date]))
    ) {
      return state;
    }

    return {
      ...state,
      ...(task.projectId
        ? {
            project: {
              ...state.project,
              [task.projectId]: {
                ...state.project[task.projectId],
                [date]: stamp(state.project[task.projectId]?.[date]),
              },
            },
          }
        : {}),
      tag: {
        ...state.tag,
        ...tagIds.reduce((acc, tagId) => {
          acc[tagId] = {
            ...state.tag[tagId],
            [date]: stamp(state.tag[tagId]?.[date]),
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
