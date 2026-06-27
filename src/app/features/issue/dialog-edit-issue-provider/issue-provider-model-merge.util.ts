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
  // Shallow top-level merge: preserves top-level keys omitted from a partial update (the
  // actual bug). A nested object (e.g. twoWaySync) is replaced wholesale — callers always
  // emit a complete twoWaySync, so no partial-nested update occurs. The spread also copies
  // any own __proto__ key as a plain own property without touching the prototype, so no
  // explicit prototype-pollution guard is needed.
  return { ...current, ...update };
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
