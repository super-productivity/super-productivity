import type { Tag } from '@super-productivity/plugin-api';

// Super Productivity's own boards move tasks with three built-in tags that have
// fixed ids. A view that names them as "@doing", "@urgent" or "@important" shares
// those tags with the native Boards page, whatever the person has called them.

export interface TagAlias {
  id: string;
  /** Used only when the tag has to be created. */
  title: string;
  icon?: string;
}

export const TAG_ALIASES: Readonly<Record<string, TagAlias>> = {
  '@doing': { id: 'KANBAN_IN_PROGRESS', title: 'in-progress' },
  '@urgent': { id: 'EM_URGENT', title: 'urgent', icon: 'emergency' },
  '@important': { id: 'EM_IMPORTANT', title: 'important', icon: 'priority_high' },
};

export const normName = (s: string): string => s.trim().toLowerCase();

export const aliasOf = (name: string): TagAlias | undefined =>
  TAG_ALIASES[normName(name)];

/** The tags a name stands for: the built-in tag for an alias, else tags by title. */
export const tagsNamed = (name: string, tags: Tag[]): Tag[] => {
  const alias = aliasOf(name);
  return alias
    ? tags.filter((t) => t.id === alias.id)
    : tags.filter((t) => normName(t.title) === normName(name));
};
