// Numeric IDs for built-in start pages.
// String values of `MiscConfig.defaultStartPage` are project IDs, or
// `view:<boardId>` for one saved view (see VIEW_START_PAGE_PREFIX).
// Values are persisted in user config — do not change existing numbers.
export enum DefaultStartPage {
  Today = 0,
  Inbox = 1, // Legacy — new configs store INBOX_PROJECT.id as a string instead.
  Planner = 2,
  Schedule = 3,
  Boards = 4,
}

// Prefixed so a view id can't be mistaken for a project id. Older clients read
// it as an unknown project id and fall back to Today.
export const VIEW_START_PAGE_PREFIX = 'view:';

export const toViewStartPage = (boardId: string): string =>
  `${VIEW_START_PAGE_PREFIX}${boardId}`;

/** The view id of a `view:<boardId>` start page, else `undefined`. */
export const getStartPageViewId = (
  startPage: number | string | undefined,
): string | undefined =>
  typeof startPage === 'string' && startPage.startsWith(VIEW_START_PAGE_PREFIX)
    ? startPage.slice(VIEW_START_PAGE_PREFIX.length) || undefined
    : undefined;
