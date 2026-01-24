import { createReducer, on } from '@ngrx/store';
import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import * as SectionActions from './section.actions';
import { Section, SectionState } from '../section.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';

export const SECTION_FEATURE_NAME = 'section';

export const adapter: EntityAdapter<Section> = createEntityAdapter<Section>();

export const initialSectionState: SectionState = adapter.getInitialState({
    ids: [],
});

export const sectionReducer = createReducer(
    initialSectionState,
    on(SectionActions.addSection, (state, { section }) => adapter.addOne(section, state)),
    on(SectionActions.deleteSection, (state, { id }) => adapter.removeOne(id, state)),
    on(SectionActions.updateSection, (state, { section }) => adapter.updateOne(section, state)),
    on(SectionActions.loadSections, (state, { sections }) => adapter.setAll(sections, state)),
    on(SectionActions.updateSectionOrder, (state, { ids }) => {
        const idsSet = new Set(ids);
        return {
            ...state,
            ids: [...state.ids.filter(id => !idsSet.has(id as string)), ...ids]
        };
    }),
    on(loadAllData, (state, { appDataComplete }) =>
        appDataComplete.section
            ? { ...(appDataComplete.section as SectionState) }
            : state
    ),
);

export const {
    selectIds,
    selectEntities,
    selectAll,
    selectTotal,
} = adapter.getSelectors();
