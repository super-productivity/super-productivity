import type { Tag, Task } from '@super-productivity/plugin-api';
import { BoardColumn } from './spec';
import { resolveTagIds } from './query';
import { aliasOf, TagAlias, tagsNamed } from './tag-aliases';

// Board columns use the native board panel semantics: a column shows the tasks
// that have all of its tags, none of its excluded tags and the done state it
// names; dropping a task into it adds the tags, removes the excluded ones and
// sets the done state. No other field changes.

export const columnMatches = (task: Task, column: BoardColumn, tags: Tag[]): boolean => {
  const problems: string[] = [];
  const want = column.tags?.length ? resolveTagIds(column.tags, tags, problems) : [];
  if (problems.length) return false;
  const avoid = column.notTags?.length ? resolveTagIds(column.notTags, tags, []) : [];
  if (!want.every((id) => task.tagIds.includes(id))) return false;
  if (task.tagIds.some((id) => avoid.includes(id))) return false;
  if (column.isDone !== undefined && task.isDone !== column.isDone) return false;
  return true;
};

export interface DropWrite {
  changes: { tagIds?: string[]; isDone?: boolean };
  /** Tags the column needs that do not exist yet; create them first. */
  missingTags: MissingTag[];
}

/** An alias keeps the built-in id, so the tag is the one the Boards page uses. */
export type MissingTag = Pick<TagAlias, 'title'> & Partial<Pick<TagAlias, 'id' | 'icon'>>;

const missingTagOf = (name: string, tags: Tag[]): MissingTag | null => {
  if (tagsNamed(name, tags).length) return null;
  return aliasOf(name) ?? { title: name.trim() };
};

/** The task changes a drop into this column makes, or null when nothing changes. */
export const dropWrite = (
  task: Task,
  column: BoardColumn,
  tags: Tag[],
): DropWrite | null => {
  const missingTags = (column.tags ?? [])
    .map((name) => missingTagOf(name, tags))
    .filter((tag): tag is MissingTag => !!tag);
  const add = resolveTagIds(column.tags ?? [], tags, []);
  const remove = new Set(resolveTagIds(column.notTags ?? [], tags, []));
  const nextTagIds = [
    ...task.tagIds.filter((id) => !remove.has(id)),
    ...add.filter((id) => !task.tagIds.includes(id)),
  ];
  const changes: DropWrite['changes'] = {};
  const tagsChanged =
    nextTagIds.length !== task.tagIds.length ||
    nextTagIds.some((id, i) => id !== task.tagIds[i]);
  if (tagsChanged) {
    changes.tagIds = nextTagIds;
  }
  if (column.isDone !== undefined && column.isDone !== task.isDone) {
    changes.isDone = column.isDone;
  }
  if (!missingTags.length && !Object.keys(changes).length) {
    return null;
  }
  return { changes, missingTags };
};
