import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * E2E Tests for issue #7032: Markdown link in task title breaks persistence.
 *
 * These tests verify that tasks with markdown link syntax in their titles
 * persist correctly through page reloads.
 *
 * Run with: npm run e2e:file e2e/tests/import-export/markdown-link-persistence.spec.ts
 */

const dismissViteOverlay = async (page: Page): Promise<void> => {
  const overlay = page.locator('vite-error-overlay');
  const isVisible = await overlay.isVisible().catch(() => false);
  if (isVisible) {
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
};

type ExtractedTaskState = {
  title: string;
};

const getTaskStateByTitle = async (
  page: Page,
  titleIncludes: string,
): Promise<ExtractedTaskState | null> =>
  page.evaluate((title) => {
    type TaskLike = {
      title?: string;
    };
    type StoreState = {
      tasks?: {
        entities?: Record<string, TaskLike | undefined>;
      };
    };
    type StoreSubscription = {
      unsubscribe: () => void;
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => StoreSubscription;
    };
    type E2ETestHelpers = {
      store?: StoreLike;
    };

    const helpers = (window as unknown as { __e2eTestHelpers?: E2ETestHelpers })
      .__e2eTestHelpers;
    const store = helpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const task = Object.values(latestState?.tasks?.entities ?? {}).find((candidate) =>
      candidate?.title?.includes(title),
    );

    return task ? { title: task.title ?? '' } : null;
  }, titleIncludes);

const waitForLocalOpsToPersist = async (page: Page, minCount: number): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(async (expectedMinCount) => {
          // Ops are persisted in either compact ({e, o}) or full ({entityType, opType})
          // form depending on writer version — accept both.
          type StoredOperation = {
            source?: string;
            op?: {
              e?: string;
              o?: string;
              entityType?: string;
              opType?: string;
            };
          };

          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('SUP_OPS');
            request.onsuccess = (): void => resolve(request.result);
            request.onerror = (): void => reject(request.error);
          });

          try {
            const tx = db.transaction('ops', 'readonly');
            const store = tx.objectStore('ops');
            const persistedCount = await new Promise<number>((resolve, reject) => {
              const request = store.getAll();
              request.onsuccess = (): void => {
                const ops = (request.result as StoredOperation[]).filter((entry) => {
                  const entityType = entry.op?.e ?? entry.op?.entityType;
                  const opType = entry.op?.o ?? entry.op?.opType;
                  return (
                    entry.source === 'local' &&
                    ((entityType === 'GLOBAL_CONFIG' && opType === 'UPD') ||
                      entityType === 'TASK')
                  );
                });
                resolve(ops.length);
              };
              request.onerror = (): void => reject(request.error);
            });

            return persistedCount >= expectedMinCount;
          } finally {
            db.close();
          }
        }, minCount),
      { timeout: 10000 },
    )
    .toBe(true);
};

const getExtractedWebsiteTaskState = async (
  page: Page,
): Promise<ExtractedTaskState | null> =>
  page.evaluate(() => {
    type TaskLike = {
      title?: string;
    };
    type StoreState = {
      tasks?: {
        entities?: Record<string, TaskLike | undefined>;
      };
    };
    type StoreSubscription = {
      unsubscribe: () => void;
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => StoreSubscription;
    };
    type E2ETestHelpers = {
      store?: StoreLike;
    };

    const helpers = (window as unknown as { __e2eTestHelpers?: E2ETestHelpers })
      .__e2eTestHelpers;
    const store = helpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const task = Object.values(latestState?.tasks?.entities ?? {}).find(
      (candidate) =>
        candidate?.title?.includes('Website') &&
        !candidate.title.includes('https://example.com/') &&
        !candidate.title.includes('[Website]'),
    );

    return task ? { title: task.title ?? '' } : null;
  });

test.describe('@markdown-link Markdown link persistence (issue #7032)', () => {
  test('task with markdown link should survive reload', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);
    await workViewPage.addTask('[Website](https://example.com/)');
    await waitForLocalOpsToPersist(page, 1);

    const task = taskPage.getTaskByText('Website');
    await expect(task).toBeVisible();
    await expect(task.locator('a[href="https://example.com/"]')).toBeVisible();

    const persistedTaskState = await getTaskStateByTitle(
      page,
      '[Website](https://example.com/)',
    );
    expect(persistedTaskState).not.toBeNull();
    expect(persistedTaskState!.title).toContain('[Website](https://example.com/)');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = taskPage.getTaskByText('Website');
    await expect(taskAfterReload).toBeVisible();
    await expect(taskAfterReload.locator('a[href="https://example.com/"]')).toBeVisible();

    const persistedTaskStateAfterReload = await getTaskStateByTitle(
      page,
      '[Website](https://example.com/)',
    );
    expect(persistedTaskStateAfterReload).not.toBeNull();
    expect(persistedTaskStateAfterReload!.title).toContain(
      '[Website](https://example.com/)',
    );
  });

  test('task with markdown link should survive reload with urlBehavior extract', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    // Set urlBehavior to 'extract' through the same NgRx action the settings UI uses.
    const didUpdateShortSyntaxConfig = await page.evaluate(async () => {
      type StoreState = {
        globalConfig?: {
          shortSyntax?: {
            urlBehavior?: string;
          };
        };
      };
      type StoreSubscription = {
        unsubscribe: () => void;
      };
      type StoreLike = {
        dispatch: (action: unknown) => void;
        subscribe: (next: (state: StoreState) => void) => StoreSubscription;
      };
      type E2ETestHelpers = {
        store?: StoreLike;
      };

      const helpers = (window as unknown as { __e2eTestHelpers?: E2ETestHelpers })
        .__e2eTestHelpers;
      const store = helpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing');
      }

      return new Promise<boolean>((resolve, reject) => {
        const subscriptionRef: { current?: StoreSubscription } = {};
        const timeoutId = window.setTimeout(() => {
          subscriptionRef.current?.unsubscribe();
          reject(new Error('Timed out waiting for urlBehavior extract'));
        }, 5000);
        subscriptionRef.current = store.subscribe((state) => {
          if (state.globalConfig?.shortSyntax?.urlBehavior === 'extract') {
            window.clearTimeout(timeoutId);
            subscriptionRef.current?.unsubscribe();
            resolve(true);
          }
        });

        store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey: 'shortSyntax',
          sectionCfg: { urlBehavior: 'extract' },
          isSkipSnack: true,
          meta: {
            isPersistent: true,
            entityType: 'GLOBAL_CONFIG',
            entityId: 'shortSyntax',
            opType: 'UPD',
          },
        });
      });
    });
    expect(didUpdateShortSyntaxConfig).toBe(true);
    await waitForLocalOpsToPersist(page, 1);

    // Add task - extract mode removes the URL while keeping the markdown label text.
    await workViewPage.addTask('[Website](https://example.com/)');
    await waitForLocalOpsToPersist(page, 2);

    const task = taskPage.getTaskByText('Website');
    await expect(task).toBeVisible();
    await expect(task).not.toContainText('https://example.com/');
    await expect(task.locator('a[href*="example.com"]')).toHaveCount(0);

    const extractedTaskState = await getExtractedWebsiteTaskState(page);
    expect(extractedTaskState).not.toBeNull();
    expect(extractedTaskState!.title).toContain('Website');
    expect(extractedTaskState!.title).not.toContain('https://example.com/');
    expect(extractedTaskState!.title).not.toContain('[Website]');

    // Reload and verify the app still works
    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = taskPage.getTaskByText('Website');
    await expect(taskAfterReload).toBeVisible();
    await expect(taskAfterReload).not.toContainText('https://example.com/');
    await expect(taskAfterReload.locator('a[href*="example.com"]')).toHaveCount(0);

    const extractedTaskStateAfterReload = await getExtractedWebsiteTaskState(page);
    expect(extractedTaskStateAfterReload).not.toBeNull();
    expect(extractedTaskStateAfterReload!.title).toContain('Website');
    expect(extractedTaskStateAfterReload!.title).not.toContain('https://example.com/');
    expect(extractedTaskStateAfterReload!.title).not.toContain('[Website]');
  });

  test('malformed title from extract mode should survive reload', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(60000);

    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    // Directly create a task with the mangled title that extract mode produces
    const malformedTitle = 'Add [Website](';
    await workViewPage.addTask(malformedTitle);
    await waitForLocalOpsToPersist(page, 1);

    const task = taskPage.getTaskByText(malformedTitle);
    await expect(task).toBeVisible();

    const persistedTaskState = await getTaskStateByTitle(page, malformedTitle);
    expect(persistedTaskState).not.toBeNull();
    expect(persistedTaskState!.title).toContain(malformedTitle);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await dismissViteOverlay(page);

    const taskAfterReload = taskPage.getTaskByText(malformedTitle);
    await expect(taskAfterReload).toBeVisible();

    const persistedTaskStateAfterReload = await getTaskStateByTitle(page, malformedTitle);
    expect(persistedTaskStateAfterReload).not.toBeNull();
    expect(persistedTaskStateAfterReload!.title).toContain(malformedTitle);
  });
});
