import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginAPI } from '@super-productivity/plugin-api';
import {
  MARKDOWN_NOTES_CONFIG_STORAGE_KEY,
  loadMarkdownNotesConfig,
  saveMarkdownNotesConfig,
} from './config-storage';

const createMockApi = (initialValue: string | null = null): PluginAPI => {
  let stored = initialValue;
  return {
    loadSyncedData: async (key?: string): Promise<string | null> => {
      assert.equal(key, MARKDOWN_NOTES_CONFIG_STORAGE_KEY);
      return stored;
    },
    persistDataSynced: async (data: string, key?: string): Promise<void> => {
      assert.equal(key, MARKDOWN_NOTES_CONFIG_STORAGE_KEY);
      stored = data;
    },
  } as unknown as PluginAPI;
};

test('loadMarkdownNotesConfig: reads persisted config via PluginAPI keyed storage', async () => {
  const api = createMockApi(
    JSON.stringify({
      rootPath: '/notes',
      projectMappings: {
        ProjectA: 'project-a',
        ProjectB: 42,
      },
    }),
  );

  assert.deepEqual(await loadMarkdownNotesConfig(api), {
    rootPath: '/notes',
    projectMappings: {
      ProjectA: 'project-a',
    },
  });
});

test('loadMarkdownNotesConfig: falls back to empty config when storage is missing or corrupt', async () => {
  assert.deepEqual(await loadMarkdownNotesConfig(undefined), {
    rootPath: '',
    projectMappings: {},
  });
  assert.deepEqual(await loadMarkdownNotesConfig(createMockApi('{bad json')), {
    rootPath: '',
    projectMappings: {},
  });
});

test('saveMarkdownNotesConfig: persists config via PluginAPI keyed storage', async () => {
  const writes: { data: string; key: string | undefined }[] = [];
  const api = {
    persistDataSynced: async (data: string, key?: string): Promise<void> => {
      writes.push({ data, key });
    },
  } as unknown as PluginAPI;

  await saveMarkdownNotesConfig(api, {
    rootPath: '/notes',
    projectMappings: { ProjectA: 'project-a' },
  });

  assert.deepEqual(writes, [
    {
      data: JSON.stringify({
        rootPath: '/notes',
        projectMappings: { ProjectA: 'project-a' },
      }),
      key: MARKDOWN_NOTES_CONFIG_STORAGE_KEY,
    },
  ]);
});

test('saveMarkdownNotesConfig: no-ops when PluginAPI persistence is unavailable', async () => {
  await saveMarkdownNotesConfig(undefined, {
    rootPath: '/notes',
    projectMappings: {},
  });
});
