import { nanoid } from 'nanoid';
import { BoardCfg } from './boards.model';
import { DEFAULT_BOARDS } from './boards.const';
import { IMPORTANT_TAG, IN_PROGRESS_TAG, URGENT_TAG } from '../tag/tag.const';
import { Tag } from '../tag/tag.model';
import { T } from '../../t.const';

/** The tags the default views and templates use, created with their fixed ids. */
export const DEFAULT_VIEW_TAGS: readonly Tag[] = [
  IMPORTANT_TAG,
  URGENT_TAG,
  IN_PROGRESS_TAG,
];

export type ViewTemplateId = 'EISENHOWER_MATRIX' | 'KANBAN';

export interface ViewTemplate {
  id: ViewTemplateId;
  /** A translation key, also the new view's stored title. */
  title: string;
  icon: string;
}

/**
 * Starting points for a new view, offered where views are created: the
 * built-in default views (`DEFAULT_BOARDS`), as a new view with its tags.
 */
export const VIEW_TEMPLATES: readonly ViewTemplate[] = [
  {
    id: 'EISENHOWER_MATRIX',
    title: T.F.BOARDS.DEFAULT.EISENHAUER_MATRIX,
    icon: 'grid_view',
  },
  { id: 'KANBAN', title: T.F.BOARDS.DEFAULT.KANBAN, icon: 'view_kanban' },
];

const TEMPLATE_SOURCE: Record<ViewTemplateId, string> = {
  EISENHOWER_MATRIX: 'EISENHOWER_MATRIX',
  KANBAN: 'KANBAN_DEFAULT',
};

/**
 * A new view from a template, with the tags its rules name (all of them; the
 * caller creates the ones that don't exist). Board and column ids are fresh,
 * so a template can be used more than once. Titles stay translation keys, as
 * on the default views: every client translates them.
 */
export const buildViewFromTemplate = (
  id: ViewTemplateId,
  translate: (key: string) => string,
): { board: BoardCfg; tags: Tag[] } => {
  const source = DEFAULT_BOARDS.find((board) => board.id === TEMPLATE_SOURCE[id]);
  if (!source) {
    throw new Error(`Unknown view template ${id}`);
  }
  const board: BoardCfg = {
    ...source,
    id: nanoid(),
    panels: source.panels.map((panel) => ({
      ...panel,
      id: nanoid(),
      taskIds: [],
      includedTagIds: [...panel.includedTagIds],
      excludedTagIds: [...panel.excludedTagIds],
      projectIds: panel.projectIds ? [...panel.projectIds] : panel.projectIds,
    })),
  };
  const tagIds = new Set(
    board.panels.flatMap((panel) => [...panel.includedTagIds, ...panel.excludedTagIds]),
  );
  const created = Date.now();
  const tags = DEFAULT_VIEW_TAGS.filter((tag) => tagIds.has(tag.id)).map((tag) => ({
    ...tag,
    title: translate(tag.title),
    created,
  }));
  return { board, tags };
};
