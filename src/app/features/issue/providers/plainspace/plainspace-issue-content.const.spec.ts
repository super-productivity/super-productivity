import { T } from '../../../../t.const';
import { IssueFieldType } from '../../issue-content/issue-content.model';
import { PLAINSPACE_ISSUE_CONTENT_CONFIG } from './plainspace-issue-content.const';
import { PlainspaceIssue } from './plainspace-issue.model';

const makeIssue = (over: Partial<PlainspaceIssue> = {}): PlainspaceIssue =>
  ({
    id: 'ps-1',
    title: 'Shared task',
    isDone: false,
    updatedAt: '2026-06-18T00:00:00.000Z',
    url: 'https://plainspace.org/space/item/ps-1',
    projectId: 'space-1',
    scheduledAt: null,
    isRecurring: false,
    ...over,
  }) as PlainspaceIssue;

describe('PLAINSPACE_ISSUE_CONTENT_CONFIG', () => {
  const recurringField = PLAINSPACE_ISSUE_CONTENT_CONFIG.fields.find(
    (f) => f.label === T.PLAINSPACE.RECURRING,
  );
  const linkField = PLAINSPACE_ISSUE_CONTENT_CONFIG.fields.find(
    (f) => f.label === T.PLAINSPACE.OPEN_IN_PLAINSPACE,
  );

  // title/done/schedule are mirrored onto the SP task, so the panel must not echo
  // the title back as a redundant "Summary" row.
  it('does not re-show the title as a redundant Summary field', () => {
    expect(
      PLAINSPACE_ISSUE_CONTENT_CONFIG.fields.some(
        (f) => f.label === T.F.ISSUE.ISSUE_CONTENT.SUMMARY,
      ),
    ).toBe(false);
  });

  describe('recurrence indicator', () => {
    it('renders the shared `repeat` icon via a custom field', () => {
      expect(recurringField?.type).toBe(IssueFieldType.CUSTOM);
      expect(recurringField?.customTemplate).toBe('plainspace-recurring');
    });

    it('shows only when the task recurs in Plainspace', () => {
      expect(recurringField?.isVisible?.(makeIssue({ isRecurring: true }))).toBe(true);
      expect(recurringField?.isVisible?.(makeIssue({ isRecurring: false }))).toBe(false);
    });
  });

  describe('open-in-Plainspace link', () => {
    it('links to the task url', () => {
      expect(linkField?.type).toBe(IssueFieldType.LINK);
      expect(linkField?.getLink?.(makeIssue({ url: 'https://x/y' }))).toBe('https://x/y');
    });

    it('hides when there is no url', () => {
      expect(linkField?.isVisible?.(makeIssue({ url: 'https://x/y' }))).toBe(true);
      expect(linkField?.isVisible?.(makeIssue({ url: null }))).toBe(false);
    });
  });
});
