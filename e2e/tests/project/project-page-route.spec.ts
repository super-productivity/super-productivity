import { expect, test } from '@playwright/test';
import { isProjectTasksRoute } from '../../pages/project.page';

test.describe('Project page route detection', () => {
  test('rejects the archived-projects route', () => {
    expect(isProjectTasksRoute('http://localhost:4242/#/archived-projects')).toBe(false);
  });

  test('accepts a project tasks route', () => {
    expect(isProjectTasksRoute('http://localhost:4242/#/project/project-id/tasks')).toBe(
      true,
    );
  });
});
