import { expect, test } from '../../fixtures/test.fixture';
import {
  getCITimeoutMultiplier,
  waitForPluginAssets,
} from '../../helpers/plugin-test.helpers';
import {
  columnCards,
  dragTo,
  openPlugin,
  serveTurns,
  tagsOf,
  toolStream,
  ToolCall,
} from '../../helpers/ai-view-builder.helpers';

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

    const requestBodies = await serveTurns(page, [
      toolStream(KANBAN),
      toolStream(AS_LIST),
    ]);

    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);

    const plugin = await openPlugin(page);

    // A typed request is sent; the board streams in and both tasks start in To do.
    await plugin.locator('#commandInput').fill('A kanban board for what I have open');
    await plugin.locator('#commandInput').press('Enter');
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
    const tags = await tagsOf(page, first);
    expect(tags.map((t) => t.title)).toEqual(['Doing']);
  });
});
