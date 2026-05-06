import { createFeatureSelector, createSelector } from '@ngrx/store';
import { Section, SectionState } from '../section.model';
import { selectAll, SECTION_FEATURE_NAME } from './section.reducer';

export const selectSectionFeatureState =
  createFeatureSelector<SectionState>(SECTION_FEATURE_NAME);

export const selectAllSections = createSelector(selectSectionFeatureState, selectAll);

export const selectSectionById = createSelector(
  selectSectionFeatureState,
  (state: SectionState, props: { id: string }): Section | undefined =>
    state.entities[props.id],
);

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
