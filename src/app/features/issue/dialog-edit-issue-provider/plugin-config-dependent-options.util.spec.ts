import {
  getPluginConfigDependencyState,
  resetPluginDependentSelections,
} from './plugin-config-dependent-options.util';

describe('plugin-config-dependent-options.util', () => {
  it('clears project and todolist when account changes', () => {
    const nextCfg = resetPluginDependentSelections(
      { accountId: '1', bucketId: '10' },
      { accountId: '2', bucketId: '10' },
      { accountId: '2', bucketId: '10', todolistId: '99' },
    );

    expect(nextCfg).toEqual({ accountId: '2' });
  });

  it('clears only todolist when project changes', () => {
    const nextCfg = resetPluginDependentSelections(
      { accountId: '1', bucketId: '10' },
      { accountId: '1', bucketId: '20' },
      { accountId: '1', bucketId: '20', todolistId: '99' },
    );

    expect(nextCfg).toEqual({ accountId: '1', bucketId: '20' });
  });

  it('reads dependency state from plugin config', () => {
    expect(
      getPluginConfigDependencyState({
        accountId: ' 123 ',
        bucketId: 456,
      }),
    ).toEqual({ accountId: '123', bucketId: '456' });
  });
});
