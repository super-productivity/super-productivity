import {
  GITLAB_CONFIG_FORM_SECTION,
  GITLAB_PROJECT_REGEX,
} from './gitlab-cfg-form.const';

describe('GITLAB_PROJECT_REGEX', () => {
  let projectPattern: RegExp;

  beforeAll(() => {
    // Verify the form field is actually wired to the exported regex, so this
    // spec fails if someone swaps the field's `pattern` out from under it.
    const projectField = GITLAB_CONFIG_FORM_SECTION.items!.find(
      (item) => item.key === 'project',
    );
    const pattern = projectField?.templateOptions?.pattern as RegExp;
    expect(pattern).toBe(GITLAB_PROJECT_REGEX);
    projectPattern = pattern;
  });

  // Angular's Validators.pattern uses `regex.test(value)` as-is for a RegExp
  // (no auto-anchoring), so the regex itself must be anchored at both ends.
  const isValid = (value: string): boolean => projectPattern.test(value);

  describe('valid project identifiers', () => {
    const validCases = [
      'super-productivity/super-productivity',
      'group/subgroup/project',
      'my_group/my.project',
      'a.b-c/d_e',
      'group%2Fproject',
      'group%2Fsub%2Fproject',
      // GitLab allows consecutive hyphens in a path segment; must not be rejected.
      'foo--bar',
      'single',
      '12345',
    ];
    validCases.forEach((value) => {
      it(`accepts "${value}"`, () => {
        expect(isValid(value)).toBe(true);
      });
    });
  });

  describe('invalid project identifiers', () => {
    // Regression for #8665: a display name with a space must be rejected inline
    // instead of producing a confusing 404 at poll time.
    const invalidCases = [
      'My Group/My Gitlab',
      'group/Test Gitlab',
      'has space',
      ' leadingSpace',
      'trailingSpace ',
      'https://gitlab.com/foo/bar',
      'foo/bar?scope=all',
    ];
    invalidCases.forEach((value) => {
      it(`rejects "${value}"`, () => {
        expect(isValid(value)).toBe(false);
      });
    });
  });
});
