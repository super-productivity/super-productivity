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

/** Enables the plugin, opens its page and saves a fake key. Tasks go in first. */
export const openPlugin = async (page: Page): Promise<FrameLocator> => {
  expect(await waitForPluginManagementInit(page)).toBe(true);
  expect(await enablePluginWithVerification(page, PLUGIN_NAME)).toBe(true);
  expect(await waitForPluginInMenu(page, PLUGIN_NAME)).toBe(true);
  await page.goto('/#/plugins/ai-view-builder/index');
  const plugin = page.frameLocator(PLUGIN_IFRAME);
  await plugin.locator('#apiKeyInput').fill('sk-ant-e2e-key');
  await plugin.locator('#saveKeyBtn').click();
  await expect(plugin.locator('#keyStatus')).toHaveText('A key is saved on this device.');
  return plugin;
};
