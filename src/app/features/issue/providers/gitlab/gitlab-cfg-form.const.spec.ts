import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UntypedFormGroup } from '@angular/forms';
import {
  FieldType,
  FormlyFieldConfig,
  FormlyFormBuilder,
  FormlyModule,
} from '@ngx-formly/core';
import { IssueProviderGitlab } from '../../issue.model';
import {
  GITLAB_CONFIG_FORM,
  GITLAB_CONFIG_FORM_SECTION,
  GITLAB_PROJECT_REGEX,
} from './gitlab-cfg-form.const';

@Component({ selector: 'noop-formly-field', template: '', standalone: true })
class NoopFormlyFieldComponent extends FieldType {}

describe('GITLAB_CONFIG_FORM source switching', () => {
  let builder: FormlyFormBuilder;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        NoopFormlyFieldComponent,
        FormlyModule.forRoot({
          types: ['input', 'select'].map((name) => ({
            name,
            component: NoopFormlyFieldComponent,
          })),
        }),
      ],
    });
    builder = TestBed.inject(FormlyFormBuilder);
  });

  // Only the source, group and project fields, copied so each test gets fresh field state
  const buildSourceForm = (
    model: Partial<IssueProviderGitlab>,
  ): { fields: FormlyFieldConfig[]; model: Partial<IssueProviderGitlab> } => {
    const fields = GITLAB_CONFIG_FORM.filter((f) =>
      ['issueSource', 'group', 'project'].includes(f.key as string),
    ).map((f) => ({ ...f }) as FormlyFieldConfig);
    builder.buildForm(new UntypedFormGroup({}), fields, model, {});
    return { fields, model };
  };

  // What a select change does in the running dialog: set the value, re-check hide expressions
  const pickSource = (
    fields: FormlyFieldConfig[],
    model: Partial<IssueProviderGitlab>,
    source: IssueProviderGitlab['issueSource'],
  ): void => {
    const sourceField = fields.find((f) => f.key === 'issueSource')!;
    sourceField.formControl!.setValue(source);
    model.issueSource = source;
    const opts = sourceField.options as unknown as {
      checkExpressions: (field: FormlyFieldConfig) => void;
    };
    opts.checkExpressions({ fieldGroup: fields, options: sourceField.options });
  };

  it('keeps the project when switching to a group source', () => {
    const { fields, model } = buildSourceForm({
      issueSource: 'project',
      project: 'my-org/my-project',
    });

    pickSource(fields, model, 'group');

    expect(fields.find((f) => f.key === 'project')!.hide).toBe(true);
    expect(model.project).toBe('my-org/my-project');
  });

  it('keeps the group when switching back to a project source', () => {
    const { fields, model } = buildSourceForm({
      issueSource: 'group',
      group: 'my-org',
      project: 'my-org/my-project',
    });

    pickSource(fields, model, 'project');

    expect(fields.find((f) => f.key === 'group')!.hide).toBe(true);
    expect(model.group).toBe('my-org');
    expect(model.project).toBe('my-org/my-project');
  });
});

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
