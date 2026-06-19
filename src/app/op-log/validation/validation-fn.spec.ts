import { IValidation } from 'typia';
import {
  isForwardCompatibleProviderKeyError,
  validateAppDataProperty,
  validateAllData,
  validateFull,
} from './validation-fn';
import { createValidAppData, createValidTask } from './state-validity-test-utils';
import {
  IssueProvider,
  IssueProviderKey,
  IssueProviderState,
} from '../../features/issue/issue.model';
import { Task, TaskState } from '../../features/tasks/task.model';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

/**
 * Regression guard for the forward-compatibility break that surfaced as a false
 * "data corruption" / repair dialog on older clients after a newer client added a
 * provider key (`PLAINSPACE`, #8424) and synced tasks using it. See
 * `isForwardCompatibleProviderKeyError` in validation-fn.ts.
 *
 * `'__FUTURE_PROVIDER__'` stands in for any provider key newer than the running
 * build (PLAINSPACE itself is now in the union, so it would no longer reproduce).
 */
describe('validation-fn — forward-compatible provider keys', () => {
  const FUTURE_KEY = '__FUTURE_PROVIDER__' as unknown as IssueProviderKey;

  const taskState = (tasks: Task[]): TaskState => ({
    ...createValidAppData().task,
    ids: tasks.map((t) => t.id),
    entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
  });

  describe('end-to-end typia validation', () => {
    it('accepts a task whose issueType is an unknown (future) provider key', () => {
      const state = taskState([createValidTask('t1', { issueType: FUTURE_KEY })]);
      const result = validateAppDataProperty('task', state);
      expect(result.success).toBe(true);
    });

    it('accepts a known plugin: provider key (sanity check baseline)', () => {
      const state = taskState([
        createValidTask('t1', { issueType: 'plugin:some-future-plugin' }),
      ]);
      expect(validateAppDataProperty('task', state).success).toBe(true);
    });

    it('accepts an issue provider whose key is an unknown (future) provider', () => {
      // IssueProvider is a discriminated union; an unknown discriminant produces a
      // parent-object typia error, not a `.issueProviderKey` field error.
      const provider = {
        id: 'p1',
        isEnabled: true,
        issueProviderKey: '__FUTURE_PROVIDER__',
      } as unknown as IssueProvider;
      const state: IssueProviderState = { ids: ['p1'], entities: { p1: provider } };
      expect(validateAppDataProperty('issueProvider', state).success).toBe(true);
    });

    it('still rejects an issue provider whose key is a non-string', () => {
      const provider = {
        id: 'p1',
        isEnabled: true,
        issueProviderKey: 123,
      } as unknown as IssueProvider;
      const state: IssueProviderState = { ids: ['p1'], entities: { p1: provider } };
      expect(validateAppDataProperty('issueProvider', state).success).toBe(false);
    });

    it('still rejects a KNOWN-key provider with a malformed field (not over-relaxed)', () => {
      // A known discriminant matches its branch, so typia reports child-field errors
      // (not the parent "unknown key" error) — these must NOT be relaxed.
      const provider = {
        id: 'p1',
        isEnabled: 'not-a-boolean',
        issueProviderKey: 'JIRA',
      } as unknown as IssueProvider;
      const state: IssueProviderState = { ids: ['p1'], entities: { p1: provider } };
      expect(validateAppDataProperty('issueProvider', state).success).toBe(false);
    });

    it('accepts an archived task with an unknown provider key', () => {
      const base = createValidAppData().archiveYoung;
      const archive: ArchiveModel = {
        ...base,
        task: {
          ids: ['a1'],
          entities: { a1: createValidTask('a1', { issueType: FUTURE_KEY }) },
        },
      };
      expect(validateAppDataProperty('archiveYoung', archive).success).toBe(true);
    });

    it('still rejects a non-string issueType (genuine corruption)', () => {
      const state = taskState([
        createValidTask('t1', {
          issueType: 123 as unknown as IssueProviderKey,
        }),
      ]);
      expect(validateAppDataProperty('task', state).success).toBe(false);
    });

    it('still rejects when a real error coexists with an unknown provider key', () => {
      const state = taskState([
        createValidTask('t1', {
          issueType: FUTURE_KEY,
          timeEstimate: 'not-a-number' as unknown as number,
        }),
      ]);
      const result = validateAppDataProperty('task', state);
      expect(result.success).toBe(false);
      // the only surviving error must be the genuine one, not the relaxed issueType
      if (!result.success) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].path).toContain('timeEstimate');
      }
    });

    // The production sync-receive path validates via validateAllData/validateFull
    // (whole-app validators), whose error paths are prefixed (e.g.
    // `$input.task.entities.X.issueType`) — distinct from the per-property entry
    // exercised above. These guard that the relaxation fires there too.
    it('accepts unknown task + provider keys via validateAllData (whole-app entry)', () => {
      const appData = {
        ...createValidAppData(),
        task: taskState([createValidTask('t1', { issueType: FUTURE_KEY })]),
        issueProvider: {
          ids: ['p1'],
          entities: {
            p1: {
              id: 'p1',
              isEnabled: true,
              issueProviderKey: FUTURE_KEY,
            } as unknown as IssueProvider,
          },
        } as IssueProviderState,
      };
      expect(validateAllData(appData).success).toBe(true);
    });

    it('accepts unknown task + provider keys via validateFull (typia + cross-model)', () => {
      const base = createValidAppData();
      const appData = {
        ...base,
        task: taskState([createValidTask('t1', { issueType: FUTURE_KEY })]),
        // wire the task into INBOX so cross-model relationship checks pass
        project: {
          ...base.project,
          entities: {
            ...base.project.entities,
            INBOX: { ...base.project.entities['INBOX']!, taskIds: ['t1'] },
          },
        },
        issueProvider: {
          ids: ['p1'],
          entities: {
            p1: {
              id: 'p1',
              isEnabled: true,
              issueProviderKey: FUTURE_KEY,
            } as unknown as IssueProvider,
          },
        } as IssueProviderState,
      };
      expect(validateFull(appData).isValid).toBe(true);
    });
  });

  describe('isForwardCompatibleProviderKeyError', () => {
    const err = (path: string, expected: string, value: unknown): IValidation.IError => ({
      path,
      expected,
      value,
    });

    // The two `expected` strings below mirror the real typia output captured from the
    // compiled validators (scalar union vs discriminated-union member names).
    const ISSUE_TYPE_UNION =
      '("JIRA" | "GITLAB" | "NEXTCLOUD_DECK" | `plugin:${string}` | undefined)';
    const PROVIDER_MEMBER_UNION =
      '(IssueProviderJira | IssueProviderGithub | IssueProviderPluginType | undefined)';

    it('matches an unknown string issueType (scalar union field)', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.task.entities.x.issueType', ISSUE_TYPE_UNION, 'PLAINSPACE'),
        ),
      ).toBe(true);
    });

    it('matches an unknown issueProviderKey via the discriminated-union parent error', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.issueProvider.entities.y', PROVIDER_MEMBER_UNION, {
            id: 'y',
            isEnabled: true,
            issueProviderKey: 'PLAINSPACE',
          }),
        ),
      ).toBe(true);
    });

    it('does NOT match a non-string issueType (genuine corruption)', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.task.entities.x.issueType', ISSUE_TYPE_UNION, 42),
        ),
      ).toBe(false);
    });

    it('does NOT match an empty string issueType', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.task.entities.x.issueType', ISSUE_TYPE_UNION, ''),
        ),
      ).toBe(false);
    });

    it('does NOT match a provider object whose key is a non-string', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.issueProvider.entities.y', PROVIDER_MEMBER_UNION, {
            id: 'y',
            issueProviderKey: 42,
          }),
        ),
      ).toBe(false);
    });

    it('does NOT match an unrelated field', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.task.entities.x.title', '(string)', 'whatever'),
        ),
      ).toBe(false);
    });

    it('does NOT match a same-named field with a different (closed) expected type', () => {
      expect(
        isForwardCompatibleProviderKeyError(
          err('$input.task.entities.x.issueType', '("A" | "B")', 'C'),
        ),
      ).toBe(false);
    });
  });
});
