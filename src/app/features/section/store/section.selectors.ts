import { createFeatureSelector, createSelector, MemoizedSelector } from '@ngrx/store';
import { Section, SectionState } from '../section.model';
import { selectAll, SECTION_FEATURE_NAME } from './section.reducer';

export const selectSectionFeatureState =
  createFeatureSelector<SectionState>(SECTION_FEATURE_NAME);

export const selectAllSections = createSelector(selectSectionFeatureState, selectAll);

/**
 * Memoized selector grouping sections by contextId. Replaces the per-call
 * factory pattern from the original PR so consumers share a cache instance.
 */
export const selectSectionsByContextIdMap = createSelector(
  selectAllSections,
  (sections): Record<string, Section[]> => {
    const map: Record<string, Section[]> = {};
    for (const s of sections) {
      if (!map[s.contextId]) map[s.contextId] = [];
      map[s.contextId].push(s);
    }
    return map;
  },
);

export const selectSectionsByContextId = (
  contextId: string,
): MemoizedSelector<object, Section[]> =>
  createSelector(selectSectionsByContextIdMap, (map) => map[contextId] ?? []);
