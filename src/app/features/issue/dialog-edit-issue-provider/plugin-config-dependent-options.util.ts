export interface PluginConfigDependencyState {
  accountId: string;
  bucketId: string;
}

export const getPluginConfigDependencyState = (
  pluginConfig: Record<string, unknown> | undefined,
): PluginConfigDependencyState => ({
  accountId: String(pluginConfig?.['accountId'] || '').trim(),
  bucketId: String(pluginConfig?.['bucketId'] || '').trim(),
});

export const resetPluginDependentSelections = (
  prev: PluginConfigDependencyState,
  next: PluginConfigDependencyState,
  pluginConfig: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const cfg = { ...(pluginConfig || {}) };

  if (prev.accountId !== next.accountId) {
    delete cfg['bucketId'];
    delete cfg['todolistId'];
    return cfg;
  }

  if (prev.bucketId !== next.bucketId) {
    delete cfg['todolistId'];
  }

  return cfg;
};
