import { createFeatureSelector, createSelector } from '@ngrx/store';
import { Section, SectionState } from '../section.model';
import { selectAll, SECTION_FEATURE_NAME } from './section.reducer';

export const selectSectionFeatureState =
  createFeatureSelector<SectionState>(SECTION_FEATURE_NAME);

export const selectAllSections = createSelector(selectSectionFeatureState, selectAll);

export const selectSectionById = createSelector(
  selectSectionFeatureState,
  (state: SectionState, props: { id: string }): Section | undefined => {
    const s = state.entities[props.id];
    return s && s.isExpanded === undefined ? { ...s, isExpanded: true } : s;
  },
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
      const section = s.isExpanded === undefined ? { ...s, isExpanded: true } : s;
      const arr = map.get(section.contextId);
      if (arr) {
        arr.push(section);
      } else {
        map.set(section.contextId, [section]);
      }
    }
    return map;
  },
);
