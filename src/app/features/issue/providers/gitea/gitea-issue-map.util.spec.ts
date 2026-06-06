import {
  hasAllLabels,
  isIssueIncludedByLabels,
  parseLabelList,
} from './gitea-issue-map.util';
import { GiteaIssue, GiteaLabel } from './gitea-issue.model';

const makeLabel = (name: string): GiteaLabel =>
  ({ id: 0, name, color: '', description: '', url: '' }) as GiteaLabel;

const makeIssue = (labels: GiteaLabel[] | undefined): GiteaIssue =>
  ({ labels }) as unknown as GiteaIssue;

describe('gitea-issue-map.util', () => {
  describe('parseLabelList', () => {
    it('returns [] for null', () => {
      expect(parseLabelList(null)).toEqual([]);
    });

    it('returns [] for an empty string', () => {
      expect(parseLabelList('')).toEqual([]);
    });

    it('returns [] when only whitespace and commas', () => {
      expect(parseLabelList('  ,  ,,')).toEqual([]);
    });

    it('trims whitespace around each entry', () => {
      expect(parseLabelList('  bug , enhancement  ,  docs ')).toEqual([
        'bug',
        'enhancement',
        'docs',
      ]);
    });

    it('preserves scoped labels with slashes', () => {
      expect(parseLabelList('project/uconsole,bug')).toEqual(['project/uconsole', 'bug']);
    });
  });

  describe('isIssueIncludedByLabels', () => {
    it('includes any issue when the exclude list is empty', () => {
      const issue = makeIssue([makeLabel('bug')]);
      expect(isIssueIncludedByLabels(issue, [])).toBe(true);
    });

    it('includes issues that carry none of the excluded labels', () => {
      const issue = makeIssue([makeLabel('bug'), makeLabel('enhancement')]);
      expect(isIssueIncludedByLabels(issue, ['wontfix'])).toBe(true);
    });

    it('excludes an issue that carries an excluded label', () => {
      const issue = makeIssue([makeLabel('bug'), makeLabel('wontfix')]);
      expect(isIssueIncludedByLabels(issue, ['wontfix'])).toBe(false);
    });

    it('excludes when any of multiple excluded labels matches', () => {
      const issue = makeIssue([makeLabel('docs')]);
      expect(isIssueIncludedByLabels(issue, ['wontfix', 'docs', 'stale'])).toBe(false);
    });

    it('treats missing issue.labels as no labels and includes the issue', () => {
      const issue = makeIssue(undefined);
      expect(isIssueIncludedByLabels(issue, ['wontfix'])).toBe(true);
    });

    it('matches scoped label names exactly', () => {
      const issue = makeIssue([makeLabel('project/ai')]);
      expect(isIssueIncludedByLabels(issue, ['project/uconsole'])).toBe(true);
      expect(isIssueIncludedByLabels(issue, ['project/ai'])).toBe(false);
    });
  });

  describe('hasAllLabels', () => {
    it('includes any issue when the required list is empty', () => {
      const issue = makeIssue([makeLabel('bug')]);
      expect(hasAllLabels(issue, [])).toBe(true);
    });

    it('includes issues that carry every required label', () => {
      const issue = makeIssue([
        makeLabel('bug'),
        makeLabel('enhancement'),
        makeLabel('docs'),
      ]);
      expect(hasAllLabels(issue, ['bug', 'enhancement'])).toBe(true);
    });

    it('excludes issues missing any required label (AND semantics)', () => {
      const issue = makeIssue([makeLabel('bug')]);
      expect(hasAllLabels(issue, ['bug', 'wontfix'])).toBe(false);
    });

    it('treats missing issue.labels as no labels and excludes the issue', () => {
      const issue = makeIssue(undefined);
      expect(hasAllLabels(issue, ['bug'])).toBe(false);
    });

    it('matches scoped label names exactly', () => {
      const issue = makeIssue([makeLabel('project/ai'), makeLabel('bug')]);
      expect(hasAllLabels(issue, ['project/ai', 'bug'])).toBe(true);
      expect(hasAllLabels(issue, ['project/uconsole', 'bug'])).toBe(false);
    });
  });
});
