import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIssueKeys, findTaskForWindow, parseRules } from './match';
import { makeTask } from './test-task';

test('parseRules: parses lines, skips comments, blanks and malformed lines', () => {
  const rules = parseRules(
    '# comment\n\nFigma = Landing Page\nno separator\n= empty\nx =',
  );
  assert.deepEqual(rules, [{ pattern: 'figma', taskTitle: 'landing page' }]);
  assert.deepEqual(parseRules(undefined), []);
});

test('parseRules: only the first = separates, so titles may contain =', () => {
  assert.deepEqual(parseRules('code = a = b'), [{ pattern: 'code', taskTitle: 'a = b' }]);
});

test('extractIssueKeys: finds Jira keys and #numbers, deduped', () => {
  assert.deepEqual(extractIssueKeys('PROJ-12 fix #34 and PROJ-12 again'), [
    'PROJ-12',
    '34',
  ]);
  assert.deepEqual(extractIssueKeys('proj-12 lower case, A-1'), []);
});

const tasks = [
  makeTask({ id: 'a', title: 'Landing page' }),
  makeTask({ id: 'b', title: 'PROJ-7 Login bug' }),
  makeTask({ id: 'c', title: 'Fix crash #42' }),
  makeTask({ id: 'd', title: 'Other', issueId: '99' }),
  makeTask({ id: 'e', title: 'Done thing', isDone: true }),
];

test('findTaskForWindow: rule matches app or title case-insensitively', () => {
  const rules = parseRules('figma = landing page');
  assert.equal(findTaskForWindow({ app: 'Figma', title: '' }, rules, tasks)?.id, 'a');
  assert.equal(
    findTaskForWindow({ app: 'Chrome', title: 'FIGMA – x' }, rules, tasks)?.id,
    'a',
  );
});

test('findTaskForWindow: rules win over issue keys', () => {
  const rules = parseRules('jira = landing page');
  const sample = { app: 'Chrome', title: 'PROJ-7 - Jira' };
  assert.equal(findTaskForWindow(sample, rules, tasks)?.id, 'a');
  assert.equal(findTaskForWindow(sample, [], tasks)?.id, 'b');
});

test('findTaskForWindow: #number matches title or issueId', () => {
  assert.equal(findTaskForWindow({ app: 'x', title: 'PR #42' }, [], tasks)?.id, 'c');
  assert.equal(findTaskForWindow({ app: 'x', title: 'Issue #99' }, [], tasks)?.id, 'd');
  assert.equal(findTaskForWindow({ app: 'x', title: 'Issue #4' }, [], tasks), null);
});

test('findTaskForWindow: ambiguous issue keys do not match', () => {
  const dupes = [
    makeTask({ id: 'x', title: 'A #5' }),
    makeTask({ id: 'y', title: 'B #5' }),
  ];
  assert.equal(findTaskForWindow({ app: 'x', title: '#5' }, [], dupes), null);
});

test('findTaskForWindow: done tasks are ignored', () => {
  const rules = parseRules('x = done thing');
  assert.equal(findTaskForWindow({ app: 'x', title: '' }, rules, tasks), null);
});
