import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Covers persisted entity shapes that are otherwise easy to omit when adding a
 * model to the op registry: adapter, map, singleton, array, and plugin arrays.
 * The actions enter through the real browser store and traverse the complete
 * SuperSync capture/upload/download/replay pipeline.
 */
test.describe('@supersync Persisted Models', () => {
  test('less common persisted models round-trip between clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(150000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      const markers = {
        boardId: `board-${testRunId}`,
        folderId: `folder-${testRunId}`,
        issueProviderId: `issue-provider-${testRunId}`,
        metricId: '2099-01-02',
        plannerDay: '2099-01-03',
        pluginId: `plugin-${testRunId}`,
        sectionId: `section-${testRunId}`,
      };

      await clientA.page.evaluate((ids) => {
        type StoreLike = {
          dispatch: (action: unknown) => void;
        };
        const store = (
          window as unknown as {
            __e2eTestHelpers?: { store?: StoreLike };
          }
        ).__e2eTestHelpers?.store;
        if (!store) throw new Error('E2E store helper is unavailable');
        const persistent = (
          entityType: string,
          entityId: string,
        ): Record<string, unknown> => ({
          isPersistent: true,
          entityType,
          entityId,
          opType: 'CRT',
        });
        const actions = [
          {
            type: '[Section] Add Section',
            section: {
              id: ids.sectionId,
              contextId: 'TODAY',
              contextType: 'TAG',
              title: `Synced section ${ids.sectionId}`,
              taskIds: [],
            },
            meta: persistent('SECTION', ids.sectionId),
          },
          {
            type: '[Metric] Add Metric',
            metric: { id: ids.metricId, notes: `metric-${ids.pluginId}` },
            meta: persistent('METRIC', ids.metricId),
          },
          {
            type: '[Boards] Add Board',
            board: {
              id: ids.boardId,
              title: `Synced board ${ids.boardId}`,
              cols: 1,
              panels: [],
            },
            meta: persistent('BOARD', ids.boardId),
          },
          {
            type: '[IssueProvider/API] Add IssueProvider',
            issueProvider: {
              id: ids.issueProviderId,
              isEnabled: false,
              issueProviderKey: `plugin:${ids.pluginId}`,
              pluginId: ids.pluginId,
              pluginConfig: { source: 'sync-e2e' },
            },
            meta: persistent('ISSUE_PROVIDER', ids.issueProviderId),
          },
          {
            type: '[Planner] Upsert Planner Day',
            day: ids.plannerDay,
            taskIds: [],
            meta: {
              ...persistent('PLANNER', ids.plannerDay),
              opType: 'UPD',
            },
          },
          {
            type: '[MenuTree] Update Project Tree',
            tree: [
              {
                id: ids.folderId,
                k: 'f',
                name: `Synced folder ${ids.folderId}`,
                children: [],
              },
            ],
            meta: {
              ...persistent('MENU_TREE', 'projectTree'),
              opType: 'UPD',
            },
          },
          {
            type: '[Plugin] Upsert User Data',
            pluginUserData: { id: ids.pluginId, data: '{"synced":true}' },
            meta: {
              ...persistent('PLUGIN_USER_DATA', ids.pluginId),
              opType: 'UPD',
            },
          },
          {
            type: '[Plugin] Upsert Metadata',
            pluginMetadata: { id: ids.pluginId, isEnabled: true },
            meta: {
              ...persistent('PLUGIN_METADATA', ids.pluginId),
              opType: 'UPD',
            },
          },
        ];

        actions.forEach((action) => store.dispatch(action));
      }, markers);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      const received = await clientB.page.evaluate(async (ids) => {
        type StoreSubscription = { unsubscribe: () => void };
        type StoreLike = {
          subscribe: (next: (state: unknown) => void) => StoreSubscription;
        };
        const store = (
          window as unknown as {
            __e2eTestHelpers?: { store?: StoreLike };
          }
        ).__e2eTestHelpers?.store;
        if (!store) throw new Error('E2E store helper is unavailable');
        const state = await new Promise<Record<string, unknown>>((resolve, reject) => {
          let isDone = false;
          const subscriptionRef: { current?: StoreSubscription } = {};
          const timeoutId = window.setTimeout(() => {
            if (isDone) return;
            isDone = true;
            subscriptionRef.current?.unsubscribe();
            reject(new Error('Timed out reading NgRx state'));
          }, 1000);
          subscriptionRef.current = store.subscribe((rootState) => {
            if (isDone || typeof rootState !== 'object' || rootState === null) {
              return;
            }
            isDone = true;
            window.clearTimeout(timeoutId);
            window.setTimeout(() => subscriptionRef.current?.unsubscribe());
            resolve(rootState as Record<string, unknown>);
          });
        });
        const entities = (feature: string): Record<string, unknown> =>
          (state[feature] as { entities?: Record<string, unknown> } | undefined)
            ?.entities ?? {};
        const boards = state.boards as { boardCfgs?: Array<{ id?: string }> } | undefined;
        const planner = state.planner as { days?: Record<string, string[]> } | undefined;
        const menuTree = state.menuTree as
          | { projectTree?: Array<{ id?: string }> }
          | undefined;
        const pluginUserData = state.pluginUserData as
          | Array<{ id?: string; data?: string }>
          | undefined;
        const pluginMetadata = state.pluginMetadata as
          | Array<{ id?: string; isEnabled?: boolean }>
          | undefined;

        return {
          board: boards?.boardCfgs?.find((board) => board.id === ids.boardId),
          folder: menuTree?.projectTree?.find((node) => node.id === ids.folderId),
          issueProvider: entities('issueProvider')[ids.issueProviderId],
          metric: entities('metric')[ids.metricId],
          plannerTaskIds: planner?.days?.[ids.plannerDay],
          pluginData: pluginUserData?.find((item) => item.id === ids.pluginId),
          pluginMetadata: pluginMetadata?.find((item) => item.id === ids.pluginId),
          section: entities('section')[ids.sectionId],
        };
      }, markers);

      expect(received.section).toMatchObject({
        id: markers.sectionId,
        contextId: 'TODAY',
        contextType: 'TAG',
        title: `Synced section ${markers.sectionId}`,
        taskIds: [],
      });
      expect(received.metric).toMatchObject({ notes: `metric-${markers.pluginId}` });
      expect(received.board).toMatchObject({
        id: markers.boardId,
        title: `Synced board ${markers.boardId}`,
        cols: 1,
        panels: [],
      });
      expect(received.issueProvider).toMatchObject({
        id: markers.issueProviderId,
        isEnabled: false,
        issueProviderKey: `plugin:${markers.pluginId}`,
        pluginId: markers.pluginId,
        pluginConfig: { source: 'sync-e2e' },
      });
      expect(received.plannerTaskIds).toEqual([]);
      expect(received.folder).toEqual({
        id: markers.folderId,
        k: 'f',
        name: `Synced folder ${markers.folderId}`,
        children: [],
      });
      expect(received.pluginData).toEqual({
        id: markers.pluginId,
        data: '{"synced":true}',
      });
      expect(received.pluginMetadata).toEqual({
        id: markers.pluginId,
        isEnabled: true,
      });
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
