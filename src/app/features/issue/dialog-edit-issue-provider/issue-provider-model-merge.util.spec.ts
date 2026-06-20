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
});
