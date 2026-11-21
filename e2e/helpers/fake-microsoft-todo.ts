import type { BrowserContext, Route } from '@playwright/test';

const GRAPH_LISTS = 'https://graph.microsoft.com/v1.0/me/todo/lists';
const CORS = {
  ['access-control-allow-origin']: '*',
  ['access-control-allow-headers']: 'authorization, content-type',
  ['access-control-allow-methods']: 'GET, POST, OPTIONS',
};

const json = (route: Route, body: unknown): Promise<void> =>
  route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: CORS, json: body });

/**
 * Fakes Microsoft for the Microsoft To Do importer, so no real account is
 * needed: the authorize page redirects straight back to the app's callback
 * with the PKCE state, the token endpoint returns a fixed token, and Graph
 * answers the list and per-list task requests from the given fixtures (raw
 * Graph shapes). Returns the Authorization headers Graph received.
 */
export const fakeMicrosoftTodo = async (
  context: BrowserContext,
  lists: unknown[],
  tasksByListId: Record<string, unknown[]>,
): Promise<(string | undefined)[]> => {
  const graphAuth: (string | undefined)[] = [];
  await context.route('https://login.microsoftonline.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/authorize')) {
      const callback = new URL(url.searchParams.get('redirect_uri') as string);
      callback.searchParams.set('code', 'fake-code');
      callback.searchParams.set('state', url.searchParams.get('state') as string);
      return route.fulfill({ status: 302, headers: { location: callback.toString() } });
    }
    return json(route, {
      access_token: 'fake-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });
  await context.route(`${GRAPH_LISTS}**`, (route) => {
    graphAuth.push(route.request().headers()['authorization']);
    // The importer URL-encodes list ids, which in real Graph data contain `=`.
    const listId = /^\/([^/?]+)\/tasks/.exec(
      route.request().url().slice(GRAPH_LISTS.length),
    )?.[1];
    return json(route, {
      value:
        listId === undefined ? lists : (tasksByListId[decodeURIComponent(listId)] ?? []),
    });
  });
  return graphAuth;
};
