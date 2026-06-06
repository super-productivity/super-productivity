import {
  selectArchivedProjects,
  selectArchivedProjectIds,
  selectArrayOfArchivedProjectIds,
} from './project.selectors';
import { Project } from '../project.model';

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
