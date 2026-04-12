import { Task } from '../tasks/task.model';

/**
 * Discriminator identifying the kind of entity stored in the trash.
 * Extend this union as support for additional entity types is added.
 */
export type TrashEntityType = 'TASK';

/**
 * A single trashed item. Each item is its own IndexedDB record (keyed by id)
 * so that the store can be queried by entityType and range-purged by deletedAt
 * without loading the full trash into memory.
 */
export interface TrashedItem<T = unknown> {
  /** Original entity ID — also the IndexedDB keyPath */
  id: string;
  /** Discriminator — indexed for filtered queries */
  entityType: TrashEntityType;
  /** The original entity snapshot, used for restore */
  data: T;
  /** Entity-specific restore metadata (project/tag/parent info, etc.) */
  restoreContext: Record<string, unknown>;
  /** Epoch ms at which the item was trashed — indexed for expiry purge */
  deletedAt: number;
}

/** Task-specific restore context captured at time of deletion. */
export interface TaskRestoreContext {
  projectId?: string;
  tagIds: string[];
  parentId?: string;
  subTaskIds: string[];
  /** True if the main task lived in the project backlog at deletion time. */
  backlog: boolean;
}

/** Convenience alias: a trashed task with typed payload + restore context. */
export type TrashedTask = TrashedItem<Task> & {
  entityType: 'TASK';
  restoreContext: TaskRestoreContext;
};
