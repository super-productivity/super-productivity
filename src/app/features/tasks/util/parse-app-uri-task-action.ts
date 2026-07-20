export interface AppUriAddTaskAction {
  type: 'add';
  title: string;
  notes?: string;
  projectId?: string;
}

export interface AppUriCompleteTaskAction {
  type: 'complete';
  title: string;
}

export type AppUriTaskAction = AppUriAddTaskAction | AppUriCompleteTaskAction;

/**
 * Parses the `com.super-productivity.app://create-task?title=...` and
 * `.../complete-task?title=...` custom URL scheme actions (used by iOS
 * Shortcuts' "Open URLs" action). `create-task` (not `add-task`) matches the
 * desktop Electron protocol action name — desktop's own `add-task` action
 * already means something unrelated (opens the quick-add-task input bar).
 * Returns `null` for any other/unrecognized URL, including the existing
 * `.../oauth-callback` action handled elsewhere.
 */
export const parseAppUriTaskAction = (url: string): AppUriTaskAction | null => {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }

  // Custom URL schemes are non-special per the WHATWG URL spec, so the host
  // component is not auto-lowercased (unlike http/https) — normalize
  // explicitly, matching OAuthCallbackHandlerService's own parsing.
  const action = urlObj.hostname.toLowerCase();
  // A whitespace-only title (`title=%20`, or `title=+`, which a query string
  // decodes to a space) must not silently become an empty needle — trimmed-
  // empty means "no title", not "match every task" (see the completion
  // matching in AppUriTaskActionsService).
  const title = urlObj.searchParams.get('title')?.trim();
  if (!title) {
    return null;
  }

  if (action === 'create-task') {
    return {
      type: 'add',
      title,
      ...(urlObj.searchParams.get('notes')
        ? { notes: urlObj.searchParams.get('notes')! }
        : {}),
      ...(urlObj.searchParams.get('projectId')
        ? { projectId: urlObj.searchParams.get('projectId')! }
        : {}),
    };
  }

  if (action === 'complete-task') {
    return { type: 'complete', title };
  }

  return null;
};
