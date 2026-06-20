const QUICK_ADD_WINDOW_QUERY_PARAM = 'quickAdd';
const QUICK_ADD_WINDOW_CLASS = 'isQuickAddHud';

export const isQuickAddWindowMode = (
  location: Pick<Location, 'hash' | 'search'> = window.location,
  documentRef: Pick<Document, 'body' | 'documentElement'> = document,
): boolean =>
  new URLSearchParams(location.search).has(QUICK_ADD_WINDOW_QUERY_PARAM) ||
  location.hash.startsWith('#/quick-add') ||
  documentRef.documentElement.classList.contains(QUICK_ADD_WINDOW_CLASS) ||
  documentRef.body.classList.contains(QUICK_ADD_WINDOW_CLASS);
