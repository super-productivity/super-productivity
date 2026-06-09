import { DEFAULT_JIRA_CFG } from './jira.const';
import { JiraIssueOriginal } from './jira-api-responses';
import { mapIssue } from './jira-issue-map.util';

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
});
