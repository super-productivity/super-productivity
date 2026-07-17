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
 * Parses the `com.super-productivity.app://add-task?title=...` and
 * `.../complete-task?title=...` custom URL scheme actions (used by iOS
 * Shortcuts' "Open URLs" action, and reachable via the same scheme on
 * Android). Returns `null` for any other/unrecognized URL, including the
 * existing `.../oauth-callback` action handled elsewhere.
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
  const title = urlObj.searchParams.get('title');
  if (!title) {
    return null;
  }

  if (action === 'add-task') {
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
