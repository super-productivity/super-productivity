import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_NAME = 'AI View Builder';
const PLUGIN_IFRAME = 'plugin-index iframe';

type ToolCall = { name: string; input: Record<string, unknown> };

// A streamed model turn as the Messages API sends it: each tool call's JSON
// arrives in pieces, and the plugin applies it when the block completes.
const toolStream = (calls: ToolCall[]): string => {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { id: 'msg_e2e', role: 'assistant', content: [] } },
  ];
  calls.forEach((call, index) => {
    const json = JSON.stringify(call.input);
    events.push({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: `tool_${index}`,
        name: call.name,
        input: {},
      },
    });
    for (let i = 0; i < json.length; i += 40) {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 40) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
  events.push({ type: 'message_stop' });
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
};

const KANBAN: ToolCall[] = [
  { name: 'put_query', input: { id: 'open', props: { scope: '@current' } } },
  {
    name: 'put_component',
    input: {
      id: 'board',
      props: {
        type: 'board',
        query: 'open',
        columns: [
          { id: 'todo', title: 'To do', notTags: ['Doing'], isDone: false },
          { id: 'doing', title: 'Doing', tags: ['Doing'], isDone: false },
          { id: 'done', title: 'Done', isDone: true },
        ],
      },
    },
  },
  { name: 'set_view', input: { title: 'E2E Kanban' } },
  { name: 'say', input: { text: 'Made a board with To do, Doing and Done.' } },
];

const AS_LIST: ToolCall[] = [
  { name: 'remove_component', input: { id: 'board' } },
  {
    name: 'put_component',
    input: { id: 'list', props: { type: 'taskList', query: 'open', groupBy: 'project' } },
  },
  { name: 'say', input: { text: 'Now a list grouped by project.' } },
];

const columnCards = (
  plugin: FrameLocator,
  title: string,
): ReturnType<FrameLocator['locator']> =>
  plugin.locator('.board-col', { hasText: title }).locator('.card-title');

const dragTo = async (
  page: Page,
  plugin: FrameLocator,
  cardTitle: string,
  columnTitle: string,
): Promise<void> => {
  const from = await plugin.locator('.card', { hasText: cardTitle }).boundingBox();
  const to = await plugin.locator('.board-col', { hasText: columnTitle }).boundingBox();
  if (!from || !to) throw new Error('card or column not visible');
  // Grab the card by its title, as a user would; its buttons do not start a drag.
  const halfCardWidth = from.width / 2;
  const halfCardHeight = from.height / 2;
  const halfColumnWidth = to.width / 2;
  const grabX = from.x + halfCardWidth;
  const grabY = from.y + halfCardHeight;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 20, grabY, { steps: 4 });
  await page.mouse.move(to.x + halfColumnWidth, to.y + 40, { steps: 10 });
  await page.mouse.up();
};

test.describe('AI View Builder plugin', () => {
  test('builds a view from a request, writes drops, edits by voice and undoes', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(90000 * getCITimeoutMultiplier());
    const first = `${testPrefix}-Write report`;
    const second = `${testPrefix}-Call Alice`;

    // The web build offers push-to-talk; this stands in for the browser's recognizer.
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = '';
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        static available(): Promise<string> {
          return Promise.resolve('available');
        }
        start(): void {
          setTimeout(() => {
            // A result is a list of alternatives with an isFinal flag.
            const result = Object.assign([{ transcript: 'Make it a list by project' }], {
              isFinal: true,
            });
            this.onresult?.({ results: [result] });
            this.onend?.();
          }, 50);
        }
        stop(): void {
          this.onend?.();
        }
      }
      (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
        FakeRecognition;
    });

    const turns = [toolStream(KANBAN), toolStream(AS_LIST)];
    const requestBodies: string[] = [];
    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      const cors: [string, string][] = [
        ['access-control-allow-origin', '*'],
        ['access-control-allow-headers', '*'],
        ['access-control-allow-methods', 'POST'],
      ];
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: Object.fromEntries(cors) });
        return;
      }
      requestBodies.push(route.request().postData() || '');
      await route.fulfill({
        status: 200,
        headers: Object.fromEntries([...cors, ['content-type', 'text/event-stream']]),
        body: turns.shift() ?? toolStream([]),
      });
    });

    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);

    expect(await waitForPluginManagementInit(page)).toBe(true);
    expect(await enablePluginWithVerification(page, PLUGIN_NAME)).toBe(true);
    expect(await waitForPluginInMenu(page, PLUGIN_NAME)).toBe(true);

    await page.goto('/#/plugins/ai-view-builder/index');
    const plugin = page.frameLocator(PLUGIN_IFRAME);
    await plugin.locator('#apiKeyInput').fill('sk-ant-e2e-key');
    await plugin.locator('#saveKeyBtn').click();
    await expect(plugin.locator('#keyStatus')).toHaveText(
      'A key is saved on this device.',
    );

    // A suggestion sends its request; the board streams in and both tasks start in To do.
    await plugin.locator('#suggestions button', { hasText: 'Kanban board' }).click();
    await expect(plugin.locator('#status')).toHaveText(
      'Made a board with To do, Doing and Done.',
    );
    await expect(plugin.locator('#viewSelect option:checked')).toHaveText('E2E Kanban');
    // Today's own order: the task added last comes first.
    await expect(columnCards(plugin, 'To do')).toHaveText([second, first]);

    // A drop writes the column's tag (creating it) through the real plugin API.
    await dragTo(page, plugin, first, 'Doing');
    await expect(columnCards(plugin, 'Doing')).toHaveText([first]);
    await expect(columnCards(plugin, 'To do')).toHaveText([second]);

    // Checking a task off moves it to Done.
    await plugin
      .locator('.card', { hasText: second })
      .getByRole('button', { name: /done/ })
      .click();
    await expect(columnCards(plugin, 'Done')).toHaveText([second]);

    // Push-to-talk: the spoken request is sent and the view changes.
    await plugin.locator('#micBtn').click();
    await expect(plugin.locator('#status')).toHaveText('Now a list grouped by project.');
    await expect(plugin.locator('.board-col')).toHaveCount(0);
    await expect(plugin.locator('.c-taskList .card-title')).toHaveText([second, first]);

    // Undo is local and instant.
    await plugin.locator('#undoBtn').click();
    await expect(plugin.locator('#status')).toHaveText('Undone.');
    await expect(columnCards(plugin, 'Doing')).toHaveText([first]);

    // Only the request and the layout went to the API, never task data.
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]).toContain('Make it a list by project');
    for (const body of requestBodies) {
      expect(body).not.toContain(first);
      expect(body).not.toContain(second);
    }

    // The tag the drop created is a real tag on the real task.
    const tagged = await page.evaluate(async (title) => {
      const frame = document.querySelector('plugin-index iframe') as HTMLIFrameElement;
      const api = (frame.contentWindow as unknown as { PluginAPI: any }).PluginAPI;
      const [tasks, tags] = await Promise.all([api.getTasks(), api.getAllTags()]);
      const task = tasks.find((t: { title: string }) => t.title === title);
      return task.tagIds.map(
        (id: string) => tags.find((t: { id: string }) => t.id === id)?.title,
      );
    }, first);
    expect(tagged).toEqual(['Doing']);
  });
});
