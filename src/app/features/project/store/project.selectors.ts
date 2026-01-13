import { Project, ProjectState } from '../project.model';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { exists } from '../../../util/exists';
import { PROJECT_FEATURE_NAME, projectAdapter } from './project.reducer';
import { INBOX_PROJECT } from '../project.const';

export const selectProjectFeatureState =
  createFeatureSelector<ProjectState>(PROJECT_FEATURE_NAME);
const { selectAll } = projectAdapter.getSelectors();
export const selectAllProjects = createSelector(selectProjectFeatureState, selectAll);
export const selectAllProjectsExceptInbox = createSelector(selectAllProjects, (ps) =>
  ps.filter((p) => p.id !== INBOX_PROJECT.id),
);
export const selectUnarchivedProjects = createSelector(selectAllProjects, (projects) =>
  projects.filter((p) => !p.isArchived),
);
export const selectUnarchivedVisibleProjects = createSelector(
  selectAllProjects,
  (projects) =>
    projects.filter(
      (p) => !p.isArchived && !p.isHiddenFromMenu && p.id !== INBOX_PROJECT.id,
    ),
);
export const selectUnarchivedHiddenProjectIds = createSelector(
  selectAllProjects,
  (projects) =>
    projects.filter((p) => !p.isArchived && p.isHiddenFromMenu).map((p) => p.id),
);

export const selectArchivedProjects = createSelector(selectAllProjects, (projects) =>
  projects.filter((p) => p.isArchived),
);
export const selectAllProjectColors = createSelector(selectAllProjects, (projects) =>
  projects.reduce((prev, cur) => ({ ...prev, [cur.id]: cur.theme?.primary }), {}),
);
export const selectAllProjectColorsAndTitles = createSelector(
  selectAllProjects,
  (projects) =>
    projects.reduce(
      (prev, cur) => ({
        ...prev,
        [cur.id]: { color: cur.theme?.primary, title: cur.title },
      }),
      {},
    ),
);

// DYNAMIC SELECTORS
// -----------------
export const selectProjectById = createSelector(
  selectProjectFeatureState,
  (state: ProjectState, props: { id: string }): Project => {
    const p = state.entities[props.id];
    if (!props.id) {
      throw new Error(`No project id given – ${props.id}`);
    }
    if (!p) {
      throw new Error(`Project ${props.id} not found`);
    }
    return p;
  },
);

export const selectUnarchivedProjectsWithoutCurrent = createSelector(
  selectProjectFeatureState,
  (s: ProjectState, props: { currentId: string | null }) => {
    const ids = s.ids as string[];
    return ids
      .filter((id) => id !== props.currentId)
      .map((id) => exists(s.entities[id]) as Project)
      .filter((p) => !p.isArchived && !p.isHiddenFromMenu && p.id);
  },
);
