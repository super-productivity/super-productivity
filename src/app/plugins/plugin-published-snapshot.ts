import { CURRENT_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '@sp/shared-schema';
import { decodeFromPersist } from './util/plugin-data-codec';
import type { PluginPublishedSnapshot } from '@super-productivity/plugin-api';
import {
  assertPluginPersistenceKey,
  composeId,
  isPluginIdMatch,
} from './util/plugin-persistence-key.util';

export type PublishedPluginSnapshot = PluginPublishedSnapshot;

const invalid = (): never => {
  throw new Error('Published snapshot cannot prove task and plugin data completeness');
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};

/**
 * Projects one decoded v2 remote commit. Unlike UI archive readers, this never
 * repairs missing/malformed slices into empty collections. Transport freshness,
 * target identity and split-head exclusion remain the reader's responsibility.
 */
export const projectPublishedPluginSnapshot = async (
  input: unknown,
  pluginId: string,
  revision: string,
): Promise<PublishedPluginSnapshot> => {
  if (
    typeof pluginId !== 'string' ||
    !pluginId ||
    typeof revision !== 'string' ||
    !revision
  ) {
    return invalid();
  }
  composeId(pluginId);
  const snapshot = object(input);
  if (
    snapshot.version !== 2 ||
    snapshot.taskArchiveSnapshotVersion !== 1 ||
    !Number.isSafeInteger(snapshot.syncVersion) ||
    (snapshot.syncVersion as number) < 0 ||
    typeof snapshot.clientId !== 'string' ||
    !snapshot.clientId ||
    typeof snapshot.lastModified !== 'number' ||
    !Number.isFinite(snapshot.lastModified) ||
    snapshot.lastModified < 0 ||
    !Array.isArray(snapshot.recentOps) ||
    !Number.isSafeInteger(snapshot.schemaVersion) ||
    (snapshot.schemaVersion as number) < MIN_SUPPORTED_SCHEMA_VERSION ||
    (snapshot.schemaVersion as number) > CURRENT_SCHEMA_VERSION
  ) {
    return invalid();
  }
  const rawClock = object(snapshot.vectorClock);
  const clockEntries = Object.entries(rawClock);
  if (
    clockEntries.some(
      ([id, count]) => !id || !Number.isSafeInteger(count) || (count as number) < 0,
    )
  ) {
    return invalid();
  }
  const clock = Object.fromEntries(clockEntries) as Record<string, number>;
  const state = object(snapshot.state);
  const tasks: PublishedPluginSnapshot['tasks'] = [];
  const taskIds = new Set<string>();
  const readTasks = (value: unknown, location: 'active' | 'archive'): void => {
    const slice = object(value);
    if (!Array.isArray(slice.ids)) return invalid();
    const entities = object(slice.entities);
    const ids = new Set<string>();
    for (const id of slice.ids) {
      if (
        typeof id !== 'string' ||
        !id ||
        ids.has(id) ||
        taskIds.has(id) ||
        !Object.hasOwn(entities, id)
      ) {
        return invalid();
      }
      ids.add(id);
      taskIds.add(id);
      const task = object(entities[id]);
      if (
        task.id !== id ||
        (typeof task.isDone !== 'boolean' &&
          !(location === 'archive' && !Object.hasOwn(task, 'isDone')))
      ) {
        return invalid();
      }
      tasks.push({
        id,
        location,
        isDone: typeof task.isDone === 'boolean' ? task.isDone : null,
      });
    }
    if (Object.keys(entities).some((id) => !ids.has(id))) return invalid();
  };
  readTasks(state.task, 'active');
  readTasks(object(snapshot.archiveYoung).task, 'archive');
  readTasks(object(snapshot.archiveOld).task, 'archive');
  if (!Array.isArray(state.pluginUserData)) return invalid();
  const entityIds = new Set<string>();
  const owned: { key: string; data: string }[] = [];
  for (const value of state.pluginUserData) {
    const entry = object(value);
    if (
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.data !== 'string' ||
      entityIds.has(entry.id)
    ) {
      return invalid();
    }
    entityIds.add(entry.id);
    if (!isPluginIdMatch(entry.id, pluginId)) continue;
    const key = entry.id === pluginId ? '' : entry.id.slice(pluginId.length + 1);
    assertPluginPersistenceKey(key);
    if (composeId(pluginId, key) !== entry.id) return invalid();
    owned.push({ key, data: entry.data });
  }
  // Capture all source fields before decoding can yield. Never expose live input
  // objects or decode another plugin's payload.
  owned.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const pluginData = await Promise.all(
    owned.map(async ({ key, data }) => ({ key, value: await decodeFromPersist(data) })),
  );
  return { format: 'file-v2', revision, clock, tasks, pluginData };
};
