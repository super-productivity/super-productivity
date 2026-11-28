/** Browser-free checks for the benchmark's dataset generator and aggregation. */
import { expect, test } from '@playwright/test';
import { generateAccount, PROFILES, taskId } from './dataset';
import { aggregate, median, renderMarkdown, type Sample } from './report';

test.describe('benchmark dataset', () => {
  for (const profile of PROFILES) {
    test(`${profile.name} matches its profile`, () => {
      // generateAccount throws on a count or membership mismatch.
      const account = generateAccount(profile);
      expect(account.data.task.ids).toHaveLength(profile.totalTasks);
      expect(account.data.project.ids).toHaveLength(profile.projects);
      expect(account.focusTaskIds).toHaveLength(profile.focusTasks);
    });
  }

  test('shares the source list and first focus rows across profiles', () => {
    const accounts = PROFILES.map(generateAccount);
    for (const a of accounts) {
      expect(a.sourceTaskIds).toEqual(accounts[0].sourceTaskIds);
      expect(a.focusTaskIds.slice(0, 50)).toEqual(accounts[0].focusTaskIds.slice(0, 50));
    }
  });

  test('is deterministic', () => {
    expect(JSON.stringify(generateAccount(PROFILES[0]))).toBe(
      JSON.stringify(generateAccount(PROFILES[0])),
    );
    expect(taskId(7)).toBe('perf-t-00007');
  });
});

test.describe('benchmark aggregation', () => {
  const sample = (profile: string, ms: number, isWarmup = false): Sample => ({
    scenario: 'add-task',
    profile,
    order: 0,
    isWarmup,
    ms,
    readyMs: ms,
  });

  test('median handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  test('drops warm-ups and computes ratios against baseline', () => {
    // Long-list first: rotation can run any profile first; baseline still leads.
    const rows = aggregate([
      sample('long-list', 40),
      sample('baseline', 999, true),
      sample('baseline', 10),
      sample('baseline', 30),
      sample('long-list', 60),
    ]);
    expect(rows.map((r) => [r.profile, r.median, r.ratio])).toEqual([
      ['baseline', 20, 1],
      ['long-list', 50, 2.5],
    ]);
  });

  test('marks an invalid run in the summary', () => {
    const md = renderMarkdown({
      status: 'invalid',
      error: 'endpoint not reached',
      meta: {},
      samples: [sample('baseline', 5)],
    });
    expect(md).toContain('(invalid)');
    expect(md).toContain('endpoint not reached');
  });
});
