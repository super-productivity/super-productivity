import { DEFAULT_JIRA_CFG } from './jira.const';
import { JiraIssueOriginal } from './jira-api-responses';
import { mapIssue } from './jira-issue-map.util';
import { JiraCfg, JiraExtraFieldCfg } from './jira.model';

const makeIssue = (fields: Partial<JiraIssueOriginal['fields']>): JiraIssueOriginal =>
  ({
    key: 'SP-42',
    id: '10042',
    expand: '',
    self: 'https://jira.example.com/rest/api/2/issue/10042',
    fields: {
      summary: 'Fix the thing',
      components: [],
      attachment: [],
      timeestimate: 0,
      timespent: 0,
      description: null,
      assignee: null,
      updated: '2026-06-09T00:00:00.000+0000',
      status: {
        self: '',
        id: '3',
        description: '',
        iconUrl: '',
        name: 'In Progress',
        statusCategory: {
          self: '',
          id: '',
          key: 'indeterminate',
          colorName: 'yellow',
          name: 'In Progress',
        },
      },
      priority: null,
      issuelinks: [],
      ...fields,
    },
  }) as unknown as JiraIssueOriginal;

describe('jira-issue-map.util', () => {
  describe('mapIssue', () => {
    it('maps Jira priority metadata', () => {
      const priority = {
        self: 'https://jira.example.com/rest/api/2/priority/2',
        id: '2',
        iconUrl: 'https://jira.example.com/images/icons/priorities/high.svg',
        name: 'High',
      };

      const mapped = mapIssue(makeIssue({ priority }), DEFAULT_JIRA_CFG);

      expect(mapped.priority).toEqual(priority);
    });
  });

  describe('custom fields', () => {
    const cfgWith = (extraFields: JiraExtraFieldCfg[]): JiraCfg => ({
      ...DEFAULT_JIRA_CFG,
      extraFields,
    });

    it('formats option, number and array fields using their configured labels', () => {
      const issue = makeIssue({
        customfield_10001: { self: '', value: 'L3', id: '10' },
        customfield_10002: 8,
        customfield_10003: ['a', 'b'],
      } as Partial<JiraIssueOriginal['fields']>);

      const mapped = mapIssue(
        issue,
        cfgWith([
          { id: 'customfield_10001', label: 'Field A' },
          { id: 'customfield_10002', label: 'Field B' },
          { id: 'customfield_10003', label: 'Field C' },
        ]),
      );

      expect(mapped.extraFields).toEqual([
        { label: 'Field A', value: 'L3' },
        { label: 'Field B', value: '8' },
        { label: 'Field C', value: 'a, b' },
      ]);
    });

    it('keeps configured fields that are missing on the issue with an empty value', () => {
      const mapped = mapIssue(
        makeIssue({}),
        cfgWith([{ id: 'customfield_10001', label: 'Field A' }]),
      );

      expect(mapped.extraFields).toEqual([{ label: 'Field A', value: '' }]);
    });

    it('still maps a numeric legacy story point field to a number', () => {
      const mapped = mapIssue(
        makeIssue({ customfield_10005: 5 } as Partial<JiraIssueOriginal['fields']>),
        { ...DEFAULT_JIRA_CFG, storyPointFieldId: 'customfield_10005' },
      );

      expect(mapped.storyPoints).toBe(5);
    });

    it('does not leak an option object into storyPoints', () => {
      const mapped = mapIssue(
        makeIssue({
          customfield_10005: { value: 'L3' },
        } as Partial<JiraIssueOriginal['fields']>),
        { ...DEFAULT_JIRA_CFG, storyPointFieldId: 'customfield_10005' },
      );

      expect(mapped.storyPoints).toBeUndefined();
    });

    it('renders every standard Jira field value shape', () => {
      const issue = makeIssue({
        customfield_10101: { self: '', value: 'L3', id: '10' },
        customfield_10102: {
          self: '',
          displayName: 'Test User',
          name: 'testuser',
          key: 'testuser',
        },
        customfield_10103: { self: '', id: '5', name: 'Backend' },
        customfield_10104: { id: '9001', filename: 'spec.pdf', size: 12 },
        customfield_10105: {
          self: '',
          value: 'Frontend',
          id: '1',
          child: { self: '', value: 'Angular', id: '2' },
        },
        customfield_10106: ['a', 'b'],
        customfield_10107: 42,
      } as Partial<JiraIssueOriginal['fields']>);

      const mapped = mapIssue(
        issue,
        cfgWith([
          { id: 'customfield_10101', label: 'option' },
          { id: 'customfield_10102', label: 'user' },
          { id: 'customfield_10103', label: 'component' },
          { id: 'customfield_10104', label: 'attachment' },
          { id: 'customfield_10105', label: 'cascade' },
          { id: 'customfield_10106', label: 'array' },
          { id: 'customfield_10107', label: 'number' },
        ]),
      );

      expect(mapped.extraFields).toEqual([
        { label: 'option', value: 'L3' },
        { label: 'user', value: 'Test User' },
        { label: 'component', value: 'Backend' },
        { label: 'attachment', value: 'spec.pdf' },
        { label: 'cascade', value: 'Frontend / Angular' },
        { label: 'array', value: 'a, b' },
        { label: 'number', value: '42' },
      ]);
    });

    it('falls back to accountId for users without a display name', () => {
      const issue = makeIssue({
        customfield_10108: { accountId: 'abc-123', active: true },
      } as Partial<JiraIssueOriginal['fields']>);

      const mapped = mapIssue(
        issue,
        cfgWith([{ id: 'customfield_10108', label: 'assignee' }]),
      );

      expect(mapped.extraFields).toEqual([{ label: 'assignee', value: 'abc-123' }]);
    });
  });
});
