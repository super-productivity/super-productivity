import type { PluginAPI } from '@super-productivity/plugin-api';
import type { MarkdownNotesConfig } from './types';

export const MARKDOWN_NOTES_CONFIG_STORAGE_KEY = 'markdown-notes-config-v1';

const emptyConfig = (): MarkdownNotesConfig => ({
  rootPath: '',
  projectMappings: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseMarkdownNotesConfig = (value: unknown): MarkdownNotesConfig => {
  if (!isRecord(value)) return emptyConfig();
  const projectMappings = isRecord(value.projectMappings)
    ? Object.fromEntries(
        Object.entries(value.projectMappings).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  return {
    rootPath: typeof value.rootPath === 'string' ? value.rootPath : '',
    projectMappings,
  };
};

export const loadMarkdownNotesConfig = async (
  api: PluginAPI | undefined,
): Promise<MarkdownNotesConfig> => {
  if (!api?.loadSyncedData) return emptyConfig();

  try {
    const raw = await api.loadSyncedData(MARKDOWN_NOTES_CONFIG_STORAGE_KEY);
    if (!raw) return emptyConfig();
    return parseMarkdownNotesConfig(JSON.parse(raw) as unknown);
  } catch {
    return emptyConfig();
  }
};

export const saveMarkdownNotesConfig = async (
  api: PluginAPI | undefined,
  config: MarkdownNotesConfig,
): Promise<void> => {
  if (!api?.persistDataSynced) return;

  await api.persistDataSynced(
    JSON.stringify(parseMarkdownNotesConfig(config)),
    MARKDOWN_NOTES_CONFIG_STORAGE_KEY,
  );
};
