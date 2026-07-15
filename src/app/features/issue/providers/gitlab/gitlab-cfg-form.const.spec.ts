import {
  GITLAB_CONFIG_FORM_SECTION,
  GITLAB_PROJECT_REGEX,
} from './gitlab-cfg-form.const';

describe('GITLAB_PROJECT_REGEX', () => {
  beforeAll(() => {
    // The form field is wired to the regex SOURCE STRING (not the RegExp object),
    // because Formly writes it verbatim to the native `<input pattern>` attribute.
    // Fail here if someone swaps the field's `pattern` out from under it.
    const projectField = GITLAB_CONFIG_FORM_SECTION.items!.find(
      (item) => item.key === 'project',
    );
    const pattern = projectField?.templateOptions?.pattern;
    expect(pattern).toBe(GITLAB_PROJECT_REGEX.source);
  });

  // Angular's Validators.pattern with a string wraps it in `^(?:…)$`; the source is
  // already anchored, so it is used as-is. Testing the exported RegExp is equivalent.
  const isValid = (value: string): boolean => GITLAB_PROJECT_REGEX.test(value);

  // Regression guard for #9034: the source is written to the native `<input pattern>`
  // attribute, which Chromium compiles with the RegExp `v` flag. A value that is not
  // `v`-safe throws "Invalid regular expression" on every change-detection cycle.
  it('compiles as a native pattern attribute (RegExp `v` flag)', () => {
    expect(() => new RegExp(`^(?:${GITLAB_PROJECT_REGEX.source})$`, 'v')).not.toThrow();
  });

  it('is flag-independent so it needs no `i` flag on the attribute', () => {
    expect(GITLAB_PROJECT_REGEX.flags).toBe('');
    // The only case-sensitive literal is the encoded separator; both cases accepted.
    expect(isValid('group%2Fproject')).toBe(true);
    expect(isValid('group%2fproject')).toBe(true);
  });

  describe('valid project identifiers', () => {
    const validCases = [
      'super-productivity/super-productivity',
      'group/subgroup/project',
      'my_group/my.project',
      'a.b-c/d_e',
      'group%2Fproject',
      'group%2Fsub%2Fproject',
      // GitLab allows consecutive hyphens in a path segment; must not be rejected
      // (as long as the reference is still namespace-qualified).
      'group/foo--bar',
      '12345',
    ];
    validCases.forEach((value) => {
      it(`accepts "${value}"`, () => {
        expect(isValid(value)).toBe(true);
      });
    });
  });

  describe('invalid project identifiers', () => {
    // Regression for #8665: both a display name with a space AND a bare
    // single-segment slug (which the REST API can never resolve, so it 404s at
    // poll time) must be rejected inline instead.
    const invalidCases = [
      'My Group/My Gitlab',
      'group/Test Gitlab',
      'has space',
      ' leadingSpace',
      'trailingSpace ',
      'https://gitlab.com/foo/bar',
      'foo/bar?scope=all',
      // Missing namespace — the exact value from the #8665 logs.
      'test_config',
      'single',
      'foo--bar',
    ];
    invalidCases.forEach((value) => {
      it(`rejects "${value}"`, () => {
        expect(isValid(value)).toBe(false);
      });
    });
  });
});
