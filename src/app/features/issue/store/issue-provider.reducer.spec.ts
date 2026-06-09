import {
  issueProviderReducer,
  issueProviderInitialState,
} from './issue-provider.reducer';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { IssueProviderState } from '../issue.model';

const loadWith = (entities: Record<string, unknown>): ReturnType<typeof loadAllData> =>
  loadAllData({
    appDataComplete: {
      issueProvider: {
        ids: Object.keys(entities),
        entities,
      } as unknown as IssueProviderState,
    } as AppDataComplete,
  });

describe('issueProviderReducer loadAllData migration', () => {
  describe('GITEA → gitea-issue-provider', () => {
    const legacyGitea = {
      id: 'gp1',
      issueProviderKey: 'GITEA',
      isEnabled: true,
      host: 'https://gitea.example.com',
      token: 'tok123',
      repoFullname: 'me/repo',
      scope: 'assigned-to-me',
      filterLabels: 'bug',
      excludeLabels: 'wontfix',
    };

    it('moves connection fields into pluginConfig and sets pluginId', () => {
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ gp1: legacyGitea }),
      );
      const migrated = state.entities['gp1'] as unknown as Record<string, unknown>;
      expect(migrated['pluginId']).toBe('gitea-issue-provider');
      expect(migrated['pluginConfig']).toEqual({
        host: 'https://gitea.example.com',
        token: 'tok123',
        repoFullname: 'me/repo',
        scope: 'assigned-to-me',
        filterLabels: 'bug',
        excludeLabels: 'wontfix',
      });
    });

    it('preserves legacy top-level fields for older clients', () => {
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ gp1: legacyGitea }),
      );
      const migrated = state.entities['gp1'] as unknown as Record<string, unknown>;
      expect(migrated['host']).toBe('https://gitea.example.com');
      expect(migrated['repoFullname']).toBe('me/repo');
      expect(migrated['issueProviderKey']).toBe('GITEA');
    });

    it('defaults scope when missing', () => {
      const noScope: Record<string, unknown> = { ...legacyGitea };
      delete noScope['scope'];
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ gp1: noScope }),
      );
      const migrated = state.entities['gp1'] as unknown as Record<string, unknown>;
      expect((migrated['pluginConfig'] as Record<string, unknown>)['scope']).toBe(
        'created-by-me',
      );
    });

    it('is idempotent — already-migrated providers are left untouched', () => {
      const already = {
        ...legacyGitea,
        pluginId: 'gitea-issue-provider',
        pluginConfig: { host: 'x', token: 'y', repoFullname: 'a/b' },
      };
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ gp1: already }),
      );
      expect(state.entities['gp1'] as unknown).toBe(already);
    });
  });

  describe('LINEAR → linear-issue-provider', () => {
    const legacyLinear = {
      id: 'lp1',
      issueProviderKey: 'LINEAR',
      isEnabled: true,
      apiKey: 'lin_key',
      teamId: 'team-1',
      projectId: 'proj-1',
    };

    it('moves connection fields into pluginConfig and sets pluginId', () => {
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ lp1: legacyLinear }),
      );
      const migrated = state.entities['lp1'] as unknown as Record<string, unknown>;
      expect(migrated['pluginId']).toBe('linear-issue-provider');
      expect(migrated['pluginConfig']).toEqual({
        apiKey: 'lin_key',
        teamId: 'team-1',
        projectId: 'proj-1',
      });
    });

    it('defaults optional team/project to empty strings', () => {
      const state = issueProviderReducer(
        issueProviderInitialState,
        loadWith({ lp1: { id: 'lp1', issueProviderKey: 'LINEAR', apiKey: 'k' } }),
      );
      const cfg = (state.entities['lp1'] as unknown as Record<string, unknown>)[
        'pluginConfig'
      ] as Record<string, unknown>;
      expect(cfg).toEqual({ apiKey: 'k', teamId: '', projectId: '' });
    });
  });

  it('returns state unchanged when no legacy providers need migration', () => {
    const action = loadWith({
      jp1: { id: 'jp1', issueProviderKey: 'JIRA', isEnabled: true },
    });
    const state = issueProviderReducer(issueProviderInitialState, action);
    expect(state.entities['jp1']).toEqual(
      jasmine.objectContaining({ issueProviderKey: 'JIRA' }),
    );
    expect(
      (state.entities['jp1'] as unknown as Record<string, unknown>)['pluginConfig'],
    ).toBeUndefined();
  });
});
