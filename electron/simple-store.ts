import { promises as fs } from 'fs';
import { app } from 'electron';
import * as path from 'path';
import { error, log } from 'electron-log/main';

// Lazy getter: userData path can be changed by start-app.ts (--user-data-dir, Snap)
// before any store function is called, so we must not cache it at import time.
const getDataPath = (): string => path.join(app.getPath('userData'), 'simpleSettings');

type SimpleStoreData = { [key: string]: unknown };

export const saveSimpleStore = async (dataKey = 'main', data: unknown): Promise<void> => {
  const prevData = await loadSimpleStoreAll();
  const dataPath = getDataPath();
  const json = JSON.stringify({ ...prevData, [dataKey]: data });

  try {
    await fs.writeFile(dataPath, json, { encoding: 'utf8' });
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    if (nodeErr.code === 'EISDIR') {
      // In older app versions simpleSettings was stored as a directory.
      // Remove the legacy directory so we can write the file.
      log('simpleSettings is a directory, removing for file-based storage');
      await fs.rm(dataPath, { recursive: true });
      await fs.writeFile(dataPath, json, { encoding: 'utf8' });
    } else {
      error('Failed to save simple store:', e);
      throw e;
    }
  }
};

export const loadSimpleStoreAll = async (): Promise<SimpleStoreData> => {
  try {
    const data = await fs.readFile(getDataPath(), { encoding: 'utf8' });
    return JSON.parse(data);
  } catch (e: unknown) {
    const nodeErr = e as NodeJS.ErrnoException;
    if (nodeErr.code === 'EISDIR') {
      // In older app versions simpleSettings was stored as a directory.
      // Reading it as a file threw EISDIR which was caught/logged but
      // saveSimpleStore() would subsequently fail with an uncaught EISDIR
      // when writing to the same path. Rename to .bak to unblock writes.
      log('simpleSettings is a directory (legacy), renaming to .bak');
      try {
        await fs.rename(getDataPath(), getDataPath() + '.bak');
      } catch (renameErr) {
        error('Failed to rename legacy simpleSettings directory:', renameErr);
      }
    } else if (nodeErr.code !== 'ENOENT') {
      // ENOENT is expected on first run — only log unexpected errors
      error('Failed to load simple store:', e);
    }
    return {};
  }
};
