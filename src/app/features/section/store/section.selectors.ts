import { createFeatureSelector, createSelector, MemoizedSelector } from '@ngrx/store';
import { Section, SectionState } from '../section.model';
import { selectAll, SECTION_FEATURE_NAME } from './section.reducer';

export const selectSectionFeatureState =
  createFeatureSelector<SectionState>(SECTION_FEATURE_NAME);

export const selectAllSections = createSelector(selectSectionFeatureState, selectAll);

/**
 * Memoized selector grouping sections by contextId. A Map (not a plain
 * object) is used so that a malicious sync peer cannot poison
 * Object.prototype via a crafted contextId like "__proto__".
 */
export const selectSectionsByContextIdMap = createSelector(
  selectAllSections,
  (sections): Map<string, Section[]> => {
    const map = new Map<string, Section[]>();
    for (const s of sections) {
      const arr = map.get(s.contextId);
      if (arr) {
        arr.push(s);
      } else {
        map.set(s.contextId, [s]);
      }
    }
    return map;
  },
);

const EMPTY_SECTIONS: readonly Section[] = Object.freeze([]);

/**
 * Per-context view: returns only the sections owned by `contextId`.
 * Built off `selectSectionsByContextIdMap` so the upstream Map allocation
 * is shared across contexts within a single emission.
 */
export const selectSectionsForContext = (
  contextId: string,
): MemoizedSelector<object, readonly Section[]> =>
  createSelector(
    selectSectionsByContextIdMap,
    (map): readonly Section[] => map.get(contextId) ?? EMPTY_SECTIONS,
  );
