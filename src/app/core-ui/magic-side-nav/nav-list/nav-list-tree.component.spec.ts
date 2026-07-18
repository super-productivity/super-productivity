import { DEFAULT_PROJECT } from '../../../features/project/project.const';
import { Project } from '../../../features/project/project.model';
import { getProjectVisibilityIconColor } from './nav-list-tree.component';

const createProject = (
  overrides: Omit<Partial<Project>, 'theme'> & {
    theme?: Partial<Project['theme']>;
  },
): Project => ({
  ...DEFAULT_PROJECT,
  id: 'project-id',
  title: 'Project',
  ...overrides,
  theme: {
    ...DEFAULT_PROJECT.theme,
    ...overrides.theme,
  },
});

describe('getProjectVisibilityIconColor', () => {
  it('returns the project primary color for material icons', () => {
    const project = createProject({
      icon: 'work',
      theme: { primary: '#123456' },
    });

    expect(getProjectVisibilityIconColor(project)).toBe('#123456');
  });

  it('does not color emoji project icons', () => {
    const project = createProject({
      icon: '\u{1F680}',
      theme: { primary: '#123456' },
    });

    expect(getProjectVisibilityIconColor(project)).toBeNull();
  });

  it('uses the default material icon when a project has no icon', () => {
    const project = createProject({
      icon: undefined,
      theme: { primary: '#abcdef' },
    });

    expect(getProjectVisibilityIconColor(project)).toBe('#abcdef');
  });

  it('does not throw for a project persisted without a theme (#9139)', () => {
    // A project entity can reach the store with no `theme` at all. This helper
    // renders once per project in the side nav on every launch, and because
    // DEFAULT_PROJECT_ICON is not an emoji the theme branch is the DEFAULT
    // path — so an unguarded deref crashed the app at startup.
    // No `icon` here on purpose: that is the fall-through the comment
    // describes, so the fixture exercises the path it claims to.
    const project = createProject({});
    delete (project as unknown as Record<string, unknown>).theme;

    expect(getProjectVisibilityIconColor(project)).toBeNull();
  });
});
