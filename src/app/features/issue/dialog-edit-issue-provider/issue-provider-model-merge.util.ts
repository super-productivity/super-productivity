import { IssueProvider } from '../issue.model';

const mergePluginConfig = (
  current: Record<string, unknown> | undefined,
  update: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!current) {
    return update;
  }
  if (!update) {
    return current;
  }

  const merged = { ...current, ...update };
  const currentTwoWaySync = current['twoWaySync'];
  const updateTwoWaySync = update['twoWaySync'];

  if (
    currentTwoWaySync &&
    updateTwoWaySync &&
    typeof currentTwoWaySync === 'object' &&
    typeof updateTwoWaySync === 'object' &&
    !Array.isArray(currentTwoWaySync) &&
    !Array.isArray(updateTwoWaySync)
  ) {
    merged['twoWaySync'] = {
      ...(currentTwoWaySync as Record<string, unknown>),
      ...(updateTwoWaySync as Record<string, unknown>),
    };
  }

  return merged;
};

export const mergeIssueProviderModelUpdates = (
  currentModel: Partial<IssueProvider>,
  update: Partial<IssueProvider>,
): Partial<IssueProvider> => {
  const currentRecord = currentModel as Record<string, unknown>;
  const updateRecord = update as Record<string, unknown>;
  const next: Record<string, unknown> = { ...currentRecord };

  Object.keys(updateRecord).forEach((key) => {
    if (key === 'isEnabled') {
      return;
    }

    const updateValue = updateRecord[key];
    if (
      key === 'pluginConfig' &&
      updateValue &&
      typeof updateValue === 'object' &&
      !Array.isArray(updateValue)
    ) {
      next[key] = mergePluginConfig(
        currentRecord[key] as Record<string, unknown> | undefined,
        updateValue as Record<string, unknown>,
      );
      return;
    }

    next[key] = updateValue;
  });

  return next as Partial<IssueProvider>;
};
