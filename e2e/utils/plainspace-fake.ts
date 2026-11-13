import { expect, Page } from '@playwright/test';

// Plainspace has no E2E harness in this repo, so its integration API is stubbed
// with a small stateful fake that answers with the real wire shapes (`SPTask`,
// `/me`). The server side is covered by Plainspace's own integration tests.
// The email-code sign-in (`/api/auth/request-creation-code`, `/api/auth/connect`,
// `POST /api/projects`, `/api/projects/:slug/auth/api-tokens`) follows
// Plainspace's routes/public-auth.ts, projects.ts and api-tokens.ts.

export const PLAINSPACE_HOST = 'https://plainspace.org';

export const PLAINSPACE_SPACE = {
  id: 'space-alpha-id',
  name: 'Alpha',
  slug: 'alpha',
  memberDisplayName: 'Me',
  role: 'owner',
};

/** The integration API's task DTO (`SPTask`). */
export interface FakeSpTask {
  id: string;
  title: string;
  done: boolean;
  projectId: string;
  projectName: string;
  projectSlug: string;
  listId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  isRecurring: boolean;
}

export interface FakePatch {
  id: string;
  body: Record<string, unknown>;
  status: number;
}

export interface FakeSpace {
  id: string;
  name: string;
  slug: string;
  memberDisplayName: string;
  role: string;
}

/** An account (all memberships of one email) and its one active API key. */
export interface FakeAccount {
  activeToken: string | null;
}

export interface FakePlainspace {
  /** The spaces `/me` lists and `POST /tasks` accepts. */
  spaces: FakeSpace[];
  /** Accounts by (lowercased) email. */
  accounts: Map<string, FakeAccount>;
  /** The last code emailed to each address; consumed when used. */
  codes: Map<string, string>;
  /** API keys a later mint revoked: the integration API answers 401. */
  revokedTokens: Set<string>;
  /** The account of each minted key (other keys read as `me@e2e.test`). */
  tokenEmails: Map<string, string>;
  /** A server without email-code sign-in: those routes answer 404. */
  isAuthUnsupported: boolean;
  /** Spaces created by a sign-up (`POST /api/projects`). */
  createdProjects: { name: string; displayName: string; email: string }[];
  /** Every `/api/auth/connect` request body. */
  connectRequests: Record<string, unknown>[];
  /** Every task of the space, keyed by id. */
  tasks: Map<string, FakeSpTask>;
  /** Ids of tasks assigned to me; only these are listed, read and patched. */
  assignedIds: Set<string>;
  /** `/tasks` (the poll) gets no answer. */
  isTasksOffline: boolean;
  /** No request gets an answer: the device is offline. */
  isOffline: boolean;
  /** Requests that got no answer while offline, as `METHOD /path`. */
  offlineRequests: string[];
  /** PATCH answers 500. */
  isPatchServerError: boolean;
  /** POST /tasks (create) answers 500. */
  isCreateServerError: boolean;
  /** PATCH answers 409 with this error (any conflict other than the repeat rule). */
  patchConflictError: string | null;
  /**
   * A server from before `title`/`scheduledAt` were accepted: a PATCH without
   * `done` is a 422, and any other field next to `done` is ignored. It has no
   * members endpoint either (404).
   */
  isOldServer: boolean;
  patches: FakePatch[];
  /** The other members of the space, as `GET /spaces/:id/members` lists them. */
  members: { id: string; displayName: string }[];
  /** Runs right after a PATCH was answered, e.g. a collaborator's edit. */
  afterPatch: (() => void) | null;
  /**
   * Runs when a PATCH arrives, before it is applied: a collaborator's edit
   * that lands between our fetch and our write, so our PATCH answer carries it.
   */
  beforePatch: (() => void) | null;
  /** Titles of every create request, failed ones included. */
  creates: string[];
  taskListRequests: { status: number }[];
  /** A collaborator edits a task in Plainspace's web app. */
  remoteEdit: (id: string, changes: Partial<FakeSpTask>) => void;
  addAssignedTask: (id: string, title: string) => FakeSpTask;
}

let clock = Date.parse('2026-10-20T08:00:00.000Z');
const nextUpdatedAt = (): string => {
  clock += 60_000;
  return new Date(clock).toISOString();
};

/**
 * `shared`: route this page to an existing fake instead of a new one, so two
 * clients (two SP devices) talk to the same Plainspace space.
 */
export const installFakePlainspace = async (
  page: Page,
  shared?: FakePlainspace,
): Promise<FakePlainspace> => {
  const cors = {
    ['access-control-allow-origin']: '*',
    ['access-control-allow-headers']: 'authorization, content-type',
    ['access-control-allow-methods']: 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  const newTask = (id: string, title: string): FakeSpTask => ({
    id,
    title,
    done: false,
    projectId: PLAINSPACE_SPACE.id,
    projectName: PLAINSPACE_SPACE.name,
    projectSlug: PLAINSPACE_SPACE.slug,
    listId: 'list-1',
    url: `${PLAINSPACE_HOST}/${PLAINSPACE_SPACE.slug}/item/${id}`,
    createdAt: nextUpdatedAt(),
    updatedAt: nextUpdatedAt(),
    scheduledAt: null,
    isRecurring: false,
  });

  const server: FakePlainspace = shared ?? {
    spaces: [PLAINSPACE_SPACE],
    accounts: new Map(),
    codes: new Map(),
    revokedTokens: new Set(),
    tokenEmails: new Map(),
    isAuthUnsupported: false,
    createdProjects: [],
    connectRequests: [],
    tasks: new Map(),
    assignedIds: new Set(),
    isTasksOffline: false,
    isOffline: false,
    offlineRequests: [],
    isPatchServerError: false,
    isCreateServerError: false,
    patchConflictError: null,
    isOldServer: false,
    patches: [],
    members: [{ id: 'member-bob', displayName: 'Bob' }],
    afterPatch: null,
    beforePatch: null,
    creates: [],
    taskListRequests: [],
    remoteEdit: (id, changes) => {
      const task = server.tasks.get(id)!;
      server.tasks.set(id, { ...task, ...changes, updatedAt: nextUpdatedAt() });
    },
    addAssignedTask: (id, title) => {
      const task = newTask(id, title);
      server.tasks.set(id, task);
      server.assignedIds.add(id);
      return task;
    },
  };

  await page.route(/^https:\/\/plainspace\.org\/api\/integration\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/integration', '');
    const json = (status: number, body: unknown): Promise<void> =>
      route.fulfill({ status, headers: cors, json: body });
    const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
    const assignedTask = (id: string): FakeSpTask | undefined =>
      server.assignedIds.has(id) ? server.tasks.get(id) : undefined;
    const token = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');

    if (server.isOffline) {
      server.offlineRequests.push(`${req.method()} ${path}`);
      await route.abort('internetdisconnected');
      return;
    }
    if (server.revokedTokens.has(token)) {
      if (path === '/tasks' && req.method() === 'GET') {
        server.taskListRequests.push({ status: 401 });
      }
      await json(401, { error: 'Invalid or revoked API token' });
      return;
    }
    if (path === '/me') {
      await json(200, {
        email: server.tokenEmails.get(token) ?? 'me@e2e.test',
        projects: server.spaces,
      });
    } else if (path === '/tasks' && req.method() === 'GET') {
      if (server.isTasksOffline) {
        server.taskListRequests.push({ status: 0 });
        await route.abort('internetdisconnected');
        return;
      }
      server.taskListRequests.push({ status: 200 });
      await json(200, {
        tasks: [...server.assignedIds].map((id) => server.tasks.get(id)),
      });
    } else if (path === '/tasks' && req.method() === 'POST') {
      const body = req.postDataJSON() as { spaceId: string; title: string };
      server.creates.push(body.title);
      if (
        !server.spaces.some((sp) => sp.id === body.spaceId || sp.slug === body.spaceId)
      ) {
        await json(404, { error: 'Space not found' });
        return;
      }
      if (server.isCreateServerError) {
        await json(500, { error: 'Internal error' });
        return;
      }
      const task = server.addAssignedTask(`created-${server.creates.length}`, body.title);
      await json(201, { task });
    } else if (path === `/spaces/${PLAINSPACE_SPACE.id}/members` && !server.isOldServer) {
      await json(200, { members: server.members });
    } else if (path === '/claimable-tasks') {
      await json(200, { tasks: [] });
    } else if (taskMatch && req.method() === 'GET') {
      const task = assignedTask(taskMatch[1]);
      await (task ? json(200, { task }) : json(404, { error: 'Task not found' }));
    } else if (taskMatch && req.method() === 'PATCH') {
      const id = taskMatch[1];
      const body = req.postDataJSON() as Record<string, unknown>;
      const answer = async (status: number, resBody: unknown): Promise<void> => {
        server.patches.push({ id, body, status });
        await json(status, resBody);
        if (status === 200) {
          server.afterPatch?.();
        }
      };
      server.beforePatch?.();
      if (server.isPatchServerError) {
        await answer(500, { error: 'Internal error' });
        return;
      }
      if (server.patchConflictError) {
        await answer(409, { error: server.patchConflictError });
        return;
      }
      const task = assignedTask(id);
      if (!task) {
        await answer(404, { error: 'Task not found' });
        return;
      }
      if (server.isOldServer) {
        if (typeof body['done'] !== 'boolean') {
          await answer(422, { error: 'Invalid request. Expected { done: boolean }' });
          return;
        }
        server.remoteEdit(id, { done: body['done'] as boolean });
        await answer(200, { task: server.tasks.get(id) });
        return;
      }
      const title = body['title'];
      if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
        await answer(422, { error: 'Validation failed' });
        return;
      }
      const scheduledAt = body['scheduledAt'] as string | null | undefined;
      // Unscheduling a repeating task would drop its rule for the whole space.
      if (scheduledAt === null && task.isRecurring) {
        await answer(409, { error: 'repeat_requires_remind_at' });
        return;
      }
      const assigneeId = body['assigneeId'];
      if (assigneeId !== undefined) {
        if (assigneeId !== null && !server.members.some((m) => m.id === assigneeId)) {
          await answer(404, { error: 'Member not found' });
          return;
        }
        // Handed to someone else or released: no longer listed for me.
        server.assignedIds.delete(id);
      }
      server.remoteEdit(id, {
        ...(typeof body['done'] === 'boolean' ? { done: body['done'] } : {}),
        ...(typeof title === 'string' ? { title } : {}),
        // Stored as a timestamp and answered as UTC ISO, whatever offset came in.
        ...(scheduledAt !== undefined
          ? { scheduledAt: scheduledAt && new Date(scheduledAt).toISOString() }
          : {}),
      });
      await answer(200, { task: server.tasks.get(id) });
    } else if (taskMatch && req.method() === 'DELETE') {
      server.assignedIds.delete(taskMatch[1]);
      await route.fulfill({ status: 204, headers: cors });
    } else {
      await json(404, { error: 'Not found' });
    }
  });
  await installFakeAuth(page, server, cors);
  return server;
};

let mintCount = 0;
let spaceCount = 0;

/** The email-code sign-in routes, with the same state as the integration API. */
const installFakeAuth = async (
  page: Page,
  server: FakePlainspace,
  cors: Record<string, string>,
): Promise<void> => {
  // Member sessions of spaces created by a sign-up: token → { email, slug }.
  const memberSessions = new Map<string, { email: string; slug: string }>();
  const mint = (email: string): string => {
    const account = server.accounts.get(email)!;
    if (account.activeToken) {
      server.revokedTokens.add(account.activeToken);
    }
    const token = `pat_minted_${++mintCount}`;
    account.activeToken = token;
    server.tokenEmails.set(token, email);
    return token;
  };
  const apiToken = (): Record<string, string | null> => ({
    id: 'api-token-id',
    lastUsedAt: '2026-10-20T08:00:00.000Z',
    expiresAt: '2027-10-01T08:00:00.000Z',
    createdAt: '2026-10-01T08:00:00.000Z',
  });
  const witness = (): Record<string, string> => ({
    slug: server.spaces[0]?.slug ?? 'alpha',
    memberToken: 'member-session',
    memberId: 'member-id',
    projectName: server.spaces[0]?.name ?? 'Alpha',
  });
  // A valid, unused code for this email; consumed only when `consume`.
  const checkCode = (email: string, code: unknown, consume: boolean): boolean => {
    const valid = typeof code === 'string' && server.codes.get(email) === code;
    if (valid && consume) {
      server.codes.delete(email);
    }
    return valid;
  };

  await page.route(
    /^https:\/\/plainspace\.org\/api\/(auth|projects)(\/|$)/,
    async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      const path = new URL(req.url()).pathname.replace('/api', '');
      const json = (status: number, body: unknown): Promise<void> =>
        route.fulfill({ status, headers: cors, json: body });
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      const email = typeof body['email'] === 'string' ? body['email'].toLowerCase() : '';
      const tokenMatch = path.match(/^\/projects\/([^/]+)\/auth\/api-tokens$/);

      if (server.isAuthUnsupported || req.method() !== 'POST') {
        await route.fulfill({ status: 404, headers: cors, body: '404 Not Found' });
      } else if (path === '/auth/request-creation-code') {
        if (!email.includes('@')) {
          await json(422, { error: 'Invalid email' });
          return;
        }
        server.codes.set(email, String(100000 + server.codes.size + mintCount));
        await json(200, { message: 'Verification code sent' });
      } else if (path === '/auth/connect') {
        server.connectRequests.push(body);
        if (!checkCode(email, body['code'], false)) {
          await json(401, { error: 'Invalid or expired verification code' });
          return;
        }
        const account = server.accounts.get(email);
        if (!account) {
          await json(404, { code: 'no-account', error: 'No account for this email' });
          return;
        }
        if (body['force'] !== true && account.activeToken) {
          await json(200, {
            status: 'already-connected',
            apiToken: apiToken(),
            email,
            witness: witness(),
          });
          return;
        }
        checkCode(email, body['code'], true);
        await json(200, {
          status: 'connected',
          token: mint(email),
          email,
          witness: witness(),
        });
      } else if (path === '/projects') {
        if (!checkCode(email, body['code'], true)) {
          await json(401, { error: 'Invalid or expired verification code' });
          return;
        }
        const name = String(body['name']);
        const displayName = String(body['displayName']);
        server.createdProjects.push({ name, displayName, email });
        server.accounts.set(email, server.accounts.get(email) ?? { activeToken: null });
        const n = ++spaceCount;
        const space: FakeSpace = {
          id: `created-space-${n}-id`,
          name,
          slug: `created-${n}`,
          memberDisplayName: displayName,
          role: 'owner',
        };
        server.spaces.push(space);
        const memberToken = `member-session-${n}`;
        memberSessions.set(memberToken, { email, slug: space.slug });
        await json(201, {
          project: {
            id: space.id,
            slug: space.slug,
            name,
            purpose: '',
            sharingMode: 'open',
            createdAt: '2026-10-20T08:00:00.000Z',
            updatedAt: '2026-10-20T08:00:00.000Z',
          },
          member: { id: `member-${n}`, displayName },
          token: memberToken,
        });
      } else if (tokenMatch) {
        const session = memberSessions.get(
          (req.headers()['authorization'] ?? '').replace(/^Bearer /, ''),
        );
        if (!session || session.slug !== tokenMatch[1]) {
          await json(401, { error: 'Invalid authentication token' });
          return;
        }
        await json(201, { token: mint(session.email), apiToken: apiToken() });
      } else {
        await route.fulfill({ status: 404, headers: cors, body: '404 Not Found' });
      }
    },
  );
};

/**
 * Adds a Plainspace provider bound to the given project through the issue
 * panel's setup tab, then closes the panel. It polls in the background
 * ('always' mode) and imports the tasks assigned to me into that project.
 */
export const addPlainspaceProvider = async (
  page: Page,
  projectName: string | RegExp,
): Promise<void> => {
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await expect(page.locator('issue-panel')).toBeVisible();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'Plainspace', exact: true }).click();
  const editDialog = page.locator('dialog-edit-issue-provider');
  await editDialog.locator('input[id*="host"]').fill(PLAINSPACE_HOST);
  await editDialog.locator('input[id*="spaceId"]').fill(PLAINSPACE_SPACE.id);
  await editDialog.locator('input[id*="token"]').fill('pat_e2e');
  await editDialog.getByRole('button', { name: /Advanced Config/i }).click();
  await editDialog.locator('mat-select[id*="defaultProjectId"]').click();
  await page.getByRole('option', { name: projectName }).click();
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editDialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
};

/** Successful `/tasks` polls so far. */
export const successfulPolls = (server: FakePlainspace): number =>
  server.taskListRequests.filter((r) => r.status === 200).length;

/**
 * Waits until `count` more successful `/tasks` requests arrived after `since`
 * (a `successfulPolls` count), plus a short settle for the app to apply what
 * it got. After a load, the update poll and the import poll each request once.
 */
export const waitForPollAfter = async (
  page: Page,
  server: FakePlainspace,
  since: number,
  count = 2,
): Promise<void> => {
  await expect
    .poll(() => successfulPolls(server), { timeout: 30000 })
    .toBeGreaterThanOrEqual(since + count);
  // Deliberate: the app applies the poll's result after the response arrives.
  await page.waitForTimeout(1000);
};

/** The issue panel's open provider tab. */
export const activeProviderTab = (page: Page): ReturnType<Page['locator']> =>
  page.locator('issue-panel .mat-mdc-tab-body-active issue-provider-tab');

/**
 * Selects the issue panel tab whose header names the given space id. Retried as
 * a whole: right after the panel opens its provider tabs may not be rendered
 * yet (`count()` doesn't wait) and a click during the open animation can be
 * lost, which made a single pass fail on slower CI runners.
 */
export const openProviderTab = async (page: Page, spaceId: string): Promise<void> => {
  const tabs = page.locator('issue-panel .mat-mdc-tab');
  const header = activeProviderTab(page).locator('header .title');
  await expect(async () => {
    // The last tab is the setup overview; at least one provider tab precedes it.
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count - 1; i++) {
      await tabs.nth(i).click();
      try {
        await expect(header).toHaveText(spaceId, { timeout: 2000 });
        return;
      } catch {
        // not this tab
      }
    }
    throw new Error(`No issue panel tab for ${spaceId}`);
  }).toPass({ timeout: 30000 });
};

/** Reads a provider's stored token from its settings dialog, then closes it. */
export const providerToken = async (page: Page, spaceId: string): Promise<string> => {
  await openProviderTab(page, spaceId);
  await activeProviderTab(page).locator('header button').first().click();
  const dialog = page.locator('dialog-edit-issue-provider');
  const token = await dialog.locator('input[id*="token"]').inputValue();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return token;
};
