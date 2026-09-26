# E2E test guidance

Use this guide for tests under `e2e/`. Start with the relevant existing spec, fixture, page object, and [E2E reference](README.md). The root [AGENTS.md](../AGENTS.md) still applies, especially its sync test requirements.

## Run the right suite

```bash
npm run e2e                                      # regular tests; excludes @supersync and @webdav
npm run e2e:file e2e/tests/task-basic/task-crud.spec.ts -- --retries=0
npm run e2e:file e2e/tests/task-basic/task-crud.spec.ts -- --retries=0 --grep "should create"
npm run e2e:supersync:file e2e/tests/sync/supersync.spec.ts -- --retries=0
npm run e2e:webdav:file e2e/tests/sync/webdav-conflict-use-remote-restore-8107.spec.ts -- --retries=0
```

`e2e:file` runs a focused Playwright file without starting a provider. SuperSync and WebDAV fixtures may **skip** tests when their server is unavailable. Use the provider-specific `:file` command for single-provider tests: it starts the named server, waits for it, sets `E2E_REQUIRE_SUPERSYNC` or `E2E_REQUIRE_WEBDAV`, and makes that server's absence **fail** the run. These scripts also stop their Docker services. Keep `--retries=0` while debugging; use `--grep` to narrow a file further. `e2e:all` selects every category, but unavailable provider tests can still skip unless their required flags are set.

**Provider-switch tests need both servers.** [SuperSync to WebDAV](tests/sync/supersync-provider-switch.spec.ts) and [WebDAV to SuperSync](tests/sync/supersync-provider-switch-to-supersync.spec.ts) can still skip under `e2e:supersync:file` if WebDAV is absent. Prefer the scheduled workflow's SuperSync job for these scenarios: it starts both servers and requires both. For a local run, start and wait for WebDAV as well, and set `E2E_REQUIRE_WEBDAV=true` when invoking `e2e:supersync:file` (which sets `E2E_REQUIRE_SUPERSYNC=true`). Confirm the intended tests ran; skipped tests do not validate a fix.

For the full SuperSync and WebDAV suites, manually dispatch [E2E Tests (Scheduled)](../.github/workflows/e2e-scheduled.yml) on the branch. Its `grep` input filters SuperSync; `webdav_grep` filters WebDAV, and `run_webdav` can omit that job. Local focused runs use the npm scripts above.

## Author tests

Regular UI tests import `test` and `expect` from [test.fixture.ts](fixtures/test.fixture.ts). A test in `e2e/tests/feature/` uses `../../fixtures/test.fixture`; a deeper directory needs another `../`. The fixture creates an isolated browser context per test, skips onboarding, and waits for the app to load. Its `workViewPage`, `taskPage`, `projectPage`, `settingsPage`, `dialogPage`, `plannerPage`, `syncPage`, `tagPage`, `notePage`, and `sideNavPage` fixtures wrap common UI actions. It also provides `testPrefix` for isolated names.

```typescript
import { expect, test } from '../../fixtures/test.fixture';

test('creates a task', async ({ workViewPage, taskPage }) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Task Name');
  await expect(taskPage.getTaskByText('Task Name')).toBeVisible();
});
```

Call `waitForTaskList()` when a test needs the work view; other routes have their own readiness checks. Use existing [page objects](pages/) and [assertion helpers](utils/assertions.ts) for common operations. Prefer Playwright locators and `expect` readiness assertions to fixed delays; a short deliberate delay is justified only for behavior that actually needs elapsed time. Keep new selectors in [selectors.ts](constants/selectors.ts) when shared across tests. Read the implementation before relying on a page-object method.

Provider tests use [supersync.fixture.ts](fixtures/supersync.fixture.ts) or [webdav.fixture.ts](fixtures/webdav.fixture.ts), with an `@supersync` or `@webdav` suite title. Follow a nearby provider spec for multi-client setup, isolation, cleanup, and any required serial execution. A normal task fixture and an empty sync test body do not establish a valid sync scenario.

## Scope and verification

For a sync fix, follow the root guide's reproduction-first requirement: make the E2E test fail on the reported real-data case, then pass with the fix. Run the focused file with its matching provider command. Run `npm run checkFile <filepath>` for every changed `.ts` or `.scss` file, including specs. For browser-level test behavior, consult [Playwright configuration](playwright.config.ts) and [global setup](global-setup.ts) before changing timeouts or server startup.

For product videos under `e2e/store-video/`, also read its [task-local guide](store-video/AGENTS.md).
