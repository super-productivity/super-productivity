// Plugin config key that holds the visible label of each chosen dropdown option,
// so the provider chip and tooltip can show a name instead of a raw id.
// Each label is stored as `{ name }` so privacy export masks it.
export const PLUGIN_OPTION_LABELS_KEY = 'optionLabels';

export type PluginOptionLabels = Record<string, { name: string }>;

export interface LoadedSelectField {
  key: string;
  options: unknown;
}

const _isOption = (o: unknown): o is { label: string; value: unknown } =>
  typeof o === 'object' &&
  o !== null &&
  typeof (o as { label?: unknown }).label === 'string';

/**
 * Returns the plugin config with the labels of the chosen options of the given
 * select fields. A field whose options were never loaded keeps its old label.
 */
export const withPluginOptionLabels = (
  pluginConfig: Record<string, unknown>,
  fields: LoadedSelectField[],
): Record<string, unknown> => {
  const labels: PluginOptionLabels = {
    ...(pluginConfig[PLUGIN_OPTION_LABELS_KEY] as PluginOptionLabels | undefined),
  };
  for (const field of fields) {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      continue;
    }
    const value = pluginConfig[field.key];
    const match = field.options.find((o) => _isOption(o) && o.value === value);
    if (value !== '' && value != null && _isOption(match)) {
      labels[field.key] = { name: match.label };
    } else {
      delete labels[field.key];
    }
  }
  return { ...pluginConfig, [PLUGIN_OPTION_LABELS_KEY]: labels };
};

/** The stored label for a config key, if there is one. */
export const getPluginOptionLabel = (
  pluginConfig: Record<string, unknown>,
  key: string,
): string | undefined => {
  const labels = pluginConfig[PLUGIN_OPTION_LABELS_KEY] as
    | Partial<PluginOptionLabels>
    | undefined;
  const name: unknown = labels?.[key]?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
};
