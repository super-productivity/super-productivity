import { createFeatureSelector, createSelector } from '@ngrx/store';
import { SectionState } from '../section.model';
import { sectionReducer, selectAll, SECTION_FEATURE_NAME } from './section.reducer';

export const selectSectionFeatureState = createFeatureSelector<SectionState>(SECTION_FEATURE_NAME);

export const selectAllSections = createSelector(selectSectionFeatureState, selectAll);

export const selectSectionsByProjectId = (projectId: string) => createSelector(
    selectAllSections,
    (sections) => sections.filter(section => section.projectId === projectId)
);
