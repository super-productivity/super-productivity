import {
  selectArchivedProjects,
  selectArchivedProjectIds,
  selectArrayOfArchivedProjectIds,
  selectUnarchivedProjectsWithoutCurrent,
} from './project.selectors';
import { Project, ProjectState } from '../project.model';

const p = (o: Partial<Project>): Project => ({ ...o }) as Project;

describe('project.selectors (completion)', () => {
  const projects = [
    p({ id: 'active', isArchived: false, isDone: false }),
    p({ id: 'archived', isArchived: true, isDone: false }),
    p({ id: 'done', isArchived: true, isDone: true }),
  ];

  // REGRESSION (multi-review CRITICAL): completing a project sets isArchived, so
  // it MUST remain in selectArchivedProjects — that selector feeds
  // selectArchivedProjectIds, which task.selectors uses to keep archived
  // projects' tasks out of Today/Overdue. Narrowing it would leak completed
  // projects' (done, dueDay-carrying) tasks back into those lists.
  it('selectArchivedProjects still includes completed projects', () => {
    expect(
      selectArchivedProjects
        .projector(projects)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['archived', 'done']);
  });

  it('selectArchivedProjectIds includes completed project ids (task-filter guard)', () => {
    const archived = selectArchivedProjects.projector(projects);
    const idArr = selectArrayOfArchivedProjectIds.projector(archived);
    const idSet = selectArchivedProjectIds.projector(idArr);
    expect(idSet.has('done')).toBe(true);
    expect(idSet.has('archived')).toBe(true);
    expect(idSet.has('active')).toBe(false);
  });
});

describe('selectUnarchivedProjectsWithoutCurrent', () => {
  // Feeds every "move to project" picker (task context menu, multi-select bar, task row).
  // isHiddenFromMenu only hides a project from the sidebar, so it must stay a target (#11190).
  it('offers projects hidden from the menu but not archived or current ones', () => {
    const state = {
      ids: ['current', 'visible', 'hidden', 'archived'],
      entities: {
        current: p({ id: 'current' }),
        visible: p({ id: 'visible' }),
        hidden: p({ id: 'hidden', isHiddenFromMenu: true }),
        archived: p({ id: 'archived', isArchived: true }),
      },
    } as unknown as ProjectState;

    const result = selectUnarchivedProjectsWithoutCurrent.projector(state, {
      currentId: 'current',
    });

    expect(result.map((x) => x.id)).toEqual(['visible', 'hidden']);
  });
});
