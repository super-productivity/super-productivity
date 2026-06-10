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
});
