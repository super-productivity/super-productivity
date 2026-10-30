import type { FrameLocator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  enablePluginWithVerification,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from './plugin-test.helpers';

export const PLUGIN_NAME = 'AI View Builder';
export const PLUGIN_IFRAME = 'plugin-index iframe';

export type ToolCall = { name: string; input: Record<string, unknown> };

// A streamed model turn as the Messages API sends it: each tool call's JSON
// arrives in pieces, and the plugin applies it when the block completes.
export const toolStream = (calls: ToolCall[]): string => {
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

/**
 * Serves recorded turns in order for every request to the API and returns the
 * request bodies seen, so a test can check what was sent. `delayMs` holds the
 * answer back, to look at what the view shows while the model is still thinking.
 */
export const serveTurns = async (
  page: Page,
  turns: string[],
  delayMs = 0,
): Promise<string[]> => {
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
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      headers: Object.fromEntries([...cors, ['content-type', 'text/event-stream']]),
      body: turns.shift() ?? toolStream([]),
    });
  });
  return requestBodies;
};

/**
 * Enables the plugin and opens its page, with a fake API key saved unless
 * `withKey` is false. Tasks go in first.
 */
export const openPlugin = async (page: Page, withKey = true): Promise<FrameLocator> => {
  expect(await waitForPluginManagementInit(page)).toBe(true);
  expect(await enablePluginWithVerification(page, PLUGIN_NAME)).toBe(true);
  expect(await waitForPluginInMenu(page, PLUGIN_NAME)).toBe(true);
  await page.goto('/#/plugins/ai-view-builder/index');
  const plugin = page.frameLocator(PLUGIN_IFRAME);
  if (withKey) {
    await plugin.locator('#apiKeyInput').fill('sk-ant-e2e-key');
    await plugin.locator('#saveKeyBtn').click();
    await expect(plugin.locator('#keyStatus')).toHaveText(
      'A key is saved on this device.',
    );
  }
  return plugin;
};

export const columnCards = (
  plugin: FrameLocator,
  title: string,
): ReturnType<FrameLocator['locator']> =>
  plugin.locator('.board-col', { hasText: title }).locator('.card-title');

/** Drags a card into a board column with the mouse, as a user would. */
export const dragTo = async (
  page: Page,
  plugin: FrameLocator,
  cardTitle: string,
  columnTitle: string,
): Promise<void> => {
  // Other parts of the view may show the same task; only board cards drag.
  const card = plugin.locator('.board-col .card', { hasText: cardTitle });
  const column = plugin.locator('.board-col', { hasText: columnTitle });
  // Hovering waits until the cards stop sliding into place; measuring while
  // they move grabs whichever card is passing by.
  await card.hover();
  await column.hover();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('card or column not visible');
  // Grab the card by its middle; its buttons do not start a drag.
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

/** The tags a task carries, read through the plugin's own API. */
export const tagsOf = async (
  page: Page,
  taskTitle: string,
): Promise<{ id: string; title: string }[]> =>
  page.evaluate(async (title) => {
    const frame = document.querySelector('plugin-index iframe') as HTMLIFrameElement;
    const api = (frame.contentWindow as unknown as { PluginAPI: any }).PluginAPI;
    const [tasks, tags] = await Promise.all([api.getTasks(), api.getAllTags()]);
    const task = tasks.find((t: { title: string }) => t.title === title);
    return task.tagIds.map((id: string) => ({
      id,
      title: tags.find((t: { id: string }) => t.id === id)?.title,
    }));
  }, taskTitle);

export type TaskFacts = {
  id: string;
  title: string;
  isDone: boolean;
  parentId?: string | null;
  tagIds: string[];
  projectId?: string | null;
  timeEstimate: number;
  dueDay?: string | null;
};

/** The task with this title, read through the plugin's own API. */
export const taskOf = async (page: Page, title: string): Promise<TaskFacts | null> =>
  page.evaluate(async (wanted) => {
    const frame = document.querySelector('plugin-index iframe') as HTMLIFrameElement;
    const api = (frame.contentWindow as unknown as { PluginAPI: any }).PluginAPI;
    const tasks = await api.getTasks();
    return tasks.find((t: { title: string }) => t.title === wanted) ?? null;
  }, title);

/** The id of the task being tracked, or null. */
export const trackedTaskId = async (page: Page): Promise<string | null> =>
  page.evaluate(async () => {
    const frame = document.querySelector('plugin-index iframe') as HTMLIFrameElement;
    const api = (frame.contentWindow as unknown as { PluginAPI: any }).PluginAPI;
    return (await api.getCurrentTaskId()) ?? null;
  });

export const LIST_VIEW: ToolCall[] = [
  { name: 'put_query', input: { id: 'all', props: { scope: 'all' } } },
  {
    name: 'put_component',
    input: { id: 'list', props: { type: 'taskList', query: 'all' } },
  },
  { name: 'set_view', input: { title: 'Tasks' } },
  { name: 'say', input: { text: 'Made a list.' } },
];
