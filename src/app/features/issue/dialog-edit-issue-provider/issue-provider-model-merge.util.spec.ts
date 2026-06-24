import { mergeIssueProviderModelUpdates } from './issue-provider-model-merge.util';

describe('issue-provider-model-merge.util', () => {
  it('preserves omitted pluginConfig keys during partial updates', () => {
    const result = mergeIssueProviderModelUpdates(
      {
        pluginConfig: {
          accountId: '1',
          bucketId: '10',
          todolistId: '100',
        },
      } as any,
      {
        pluginConfig: {
          accountId: '1',
        },
      } as any,
    );

    expect((result as { pluginConfig?: Record<string, unknown> }).pluginConfig).toEqual({
      accountId: '1',
      bucketId: '10',
      todolistId: '100',
    });
  });

  it('allows explicit pluginConfig clears to overwrite existing values', () => {
    const result = mergeIssueProviderModelUpdates(
      {
        pluginConfig: {
          accountId: '1',
          bucketId: '10',
          todolistId: '100',
        },
      } as any,
      {
        pluginConfig: {
          bucketId: '',
          todolistId: '',
        },
      } as any,
    );

    expect((result as { pluginConfig?: Record<string, unknown> }).pluginConfig).toEqual({
      accountId: '1',
      bucketId: '',
      todolistId: '',
    });
  });

  it('merges nested twoWaySync updates instead of replacing them wholesale', () => {
    const result = mergeIssueProviderModelUpdates(
      {
        pluginConfig: {
          twoWaySync: {
            isDone: 'both',
            title: 'pullOnly',
          },
        },
      } as any,
      {
        pluginConfig: {
          twoWaySync: {
            isDone: 'off',
          },
        },
      } as any,
    );

    expect((result as { pluginConfig?: Record<string, unknown> }).pluginConfig).toEqual({
      twoWaySync: {
        isDone: 'off',
        title: 'pullOnly',
      },
    });
  });

  it('ignores isEnabled in the update (does not overwrite the current value)', () => {
    const result = mergeIssueProviderModelUpdates(
      { isEnabled: true, pluginConfig: { accountId: '1' } } as any,
      { isEnabled: false, pluginConfig: { accountId: '1' } } as any,
    );

    expect((result as { isEnabled?: boolean }).isEnabled).toBe(true);
  });

  it('overwrites a non-pluginConfig field while preserving an omitted pluginConfig', () => {
    const result = mergeIssueProviderModelUpdates(
      { defaultProjectId: 'p1', pluginConfig: { accountId: '1' } } as any,
      { defaultProjectId: 'p2' } as any,
    );

    expect((result as { defaultProjectId?: string }).defaultProjectId).toBe('p2');
    expect((result as { pluginConfig?: Record<string, unknown> }).pluginConfig).toEqual({
      accountId: '1',
    });
  });

  it('recursively merges nested objects in pluginConfig other than twoWaySync', () => {
    const result = mergeIssueProviderModelUpdates(
      {
        pluginConfig: {
          nestedSettings: {
            option1: 'value1',
            option2: 'value2',
          },
        },
      } as any,
      {
        pluginConfig: {
          nestedSettings: {
            option1: 'updated1',
          },
        },
      } as any,
    );

    expect((result as { pluginConfig?: Record<string, unknown> }).pluginConfig).toEqual({
      nestedSettings: {
        option1: 'updated1',
        option2: 'value2',
      },
    });
  });
});
