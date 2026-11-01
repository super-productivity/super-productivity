import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    translate: (key: string) => key,
  };
  await import('./plugin');
});

// Capture the WIQL query getNewIssuesForBacklog sends to the wiql endpoint.
// Returning an empty workItems list short-circuits the work-item detail fetch.
const captureBacklogQuery = async (config: Record<string, unknown>): Promise<string> => {
  let captured = '';
  const http = {
    post: vi.fn(async (_url: string, body: { query: string }) => {
      captured = body.query;
      return { workItems: [] };
    }),
    get: vi.fn(),
  } as unknown as PluginHttp;
  await definition.getNewIssuesForBacklog!(config, http);
  return captured;
};

describe('Azure DevOps Plugin - getNewIssuesForBacklog', () => {
  it('defaults to the assigned-to-me scope with the done-state exclusion', async () => {
    const query = await captureBacklogQuery({ project: 'MyProject' });
    expect(query).toContain(`[System.TeamProject] = 'MyProject'`);
    expect(query).toContain(`[System.State] <> 'Closed'`);
    expect(query).toContain(`[System.State] <> 'Done'`);
    expect(query).toContain(`[System.State] <> 'Removed'`);
    expect(query).toContain(`[System.AssignedTo] = @Me`);
  });

  it('omits the @Me clause when scope is "all"', async () => {
    const query = await captureBacklogQuery({ project: 'MyProject', scope: 'all' });
    expect(query).not.toContain('@Me');
    expect(query).toContain(`[System.TeamProject] = 'MyProject'`);
  });

  it('uses CreatedBy when scope is "created-by-me"', async () => {
    const query = await captureBacklogQuery({
      project: 'MyProject',
      scope: 'created-by-me',
    });
    expect(query).toContain(`[System.CreatedBy] = @Me`);
    expect(query).not.toContain(`[System.AssignedTo] = @Me`);
  });

  it('escapes single quotes in the project name', async () => {
    const query = await captureBacklogQuery({ project: "O'Brien" });
    expect(query).toContain(`[System.TeamProject] = 'O''Brien'`);
  });

  it('uses a custom WIQL query verbatim, overriding scope and project', async () => {
    const custom =
      "Select [System.Id] From WorkItems Where [System.IterationPath] = 'P\\Sprint 1'";
    const query = await captureBacklogQuery({
      project: 'MyProject',
      scope: 'all',
      autoImportWiql: custom,
    });
    expect(query).toBe(custom);
  });

  it('falls back to the default query when the custom WIQL is blank', async () => {
    const query = await captureBacklogQuery({
      project: 'MyProject',
      autoImportWiql: '   ',
    });
    expect(query).toContain(`[System.TeamProject] = 'MyProject'`);
    expect(query).toContain(`[System.AssignedTo] = @Me`);
  });
});

describe('Azure DevOps Plugin - work item fetch (#9473)', () => {
  // Process templates (e.g. on-prem Scrum) may not define DueDate/TargetDate;
  // naming a field the collection lacks fails the whole request with HTTP 400
  // (TF51535), so the list fetch must not name fields explicitly.
  it('requests no explicit field list and maps items lacking date fields', async () => {
    const get = vi.fn(async () => ({
      value: [
        {
          id: 11085,
          fields: {
            'System.Title': 'Backlog item',
            'System.WorkItemType': 'Product Backlog Item',
            'System.State': 'New',
          },
        },
      ],
    }));
    const http = {
      post: vi.fn(async () => ({ workItems: [{ id: 11085 }] })),
      get,
    } as unknown as PluginHttp;

    const results = await definition.searchIssues('Backlog', { project: 'P' }, http);

    expect(get).toHaveBeenCalledTimes(1);
    const opts = (get.mock.calls[0] as unknown[])[1] as {
      params: Record<string, string>;
    };
    expect(opts.params.ids).toBe('11085');
    expect(opts.params).not.toHaveProperty('fields');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Product Backlog Item 11085: Backlog item');
    expect(results[0].due).toBe('');
    expect(results[0].dueWithTime).toBeUndefined();
  });
});

describe('Azure DevOps Plugin - done states (#9774)', () => {
  const isDoneMapping = () =>
    definition.fieldMappings!.find((m) => m.taskField === 'isDone')!;

  it('declares Closed, Done and Removed as done states, but not Resolved', () => {
    expect(definition.doneStates).toEqual(['closed', 'done', 'removed']);
  });

  it('does not mark a Resolved work item done', () => {
    const ctx = { issueId: '1' };
    expect(isDoneMapping().toTaskValue('Resolved', ctx)).toBe(false);
    expect(isDoneMapping().toTaskValue('Closed', ctx)).toBe(true);
    expect(isDoneMapping().toTaskValue('Removed', ctx)).toBe(true);
  });
});

describe('Azure DevOps Plugin - push done state (#8556)', () => {
  const AGILE_TASK_STATES = [
    { name: 'New', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
    { name: 'Closed', category: 'Completed' },
    { name: 'Removed', category: 'Removed' },
  ];
  const SCRUM_PBI_STATES = [
    { name: 'New', category: 'Proposed' },
    { name: 'Approved', category: 'Proposed' },
    { name: 'Committed', category: 'InProgress' },
    { name: 'Done', category: 'Completed' },
    { name: 'Removed', category: 'Removed' },
  ];
  const CFG = { host: 'https://dev.azure.com/org', project: 'P', token: 'pat' };

  const mockHttp = (
    item: { type: string; state: string },
    states: { name: string; category: string }[],
  ): {
    http: PluginHttp;
    patch: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  } => {
    const get = vi.fn(async (url: string) =>
      url.includes('/workitemtypes/')
        ? { value: states }
        : {
            id: 7,
            fields: { 'System.WorkItemType': item.type, 'System.State': item.state },
          },
    );
    const patch = vi.fn(async () => ({}));
    return { http: { get, patch } as unknown as PluginHttp, patch, get };
  };

  const push = (http: PluginHttp, isDone: boolean): Promise<void> => {
    const mapping = definition.fieldMappings!.find((m) => m.taskField === 'isDone')!;
    const state = mapping.toIssueValue(isDone, { issueId: '7' });
    return definition.updateIssue!('7', { state }, CFG, http);
  };

  it('keeps the done state pull-only by default', () => {
    const mapping = definition.fieldMappings!.find((m) => m.taskField === 'isDone')!;
    expect(mapping.defaultDirection).toBe('pullOnly');
  });

  it('sends no Content-Type with the auth headers (it would override json-patch)', () => {
    const headers = definition.getHeaders(CFG) as Record<string, string>;
    expect(Object.keys(headers)).toEqual(['Authorization']);
  });

  it("closes an Agile task with its type's completed state as a json-patch", async () => {
    const { http, patch } = mockHttp(
      { type: 'Task', state: 'Active' },
      AGILE_TASK_STATES,
    );
    await push(http, true);
    expect(patch).toHaveBeenCalledWith(
      'https://dev.azure.com/org/P/_apis/wit/workitems/7?api-version=6.0',
      [{ op: 'add', path: '/fields/System.State', value: 'Closed' }],
      { headers: { 'Content-Type': 'application/json-patch+json' } },
    );
  });

  it('uses Done for a Scrum backlog item and escapes the type in the URL', async () => {
    const { http, patch, get } = mockHttp(
      { type: 'Product Backlog Item', state: 'Committed' },
      SCRUM_PBI_STATES,
    );
    await push(http, true);
    expect(get.mock.calls[1][0]).toContain(
      '/workitemtypes/Product%20Backlog%20Item/states',
    );
    expect(patch.mock.calls[0][1]).toEqual([
      { op: 'add', path: '/fields/System.State', value: 'Done' },
    ]);
  });

  it('reopens to the in-progress state', async () => {
    const { http, patch } = mockHttp(
      { type: 'Product Backlog Item', state: 'Done' },
      SCRUM_PBI_STATES,
    );
    await push(http, false);
    expect(patch.mock.calls[0][1]).toEqual([
      { op: 'add', path: '/fields/System.State', value: 'Committed' },
    ]);
  });

  it('does not write when the item is already done (including Removed)', async () => {
    for (const state of ['Closed', 'Removed']) {
      const { http, patch } = mockHttp({ type: 'Task', state }, AGILE_TASK_STATES);
      await push(http, true);
      expect(patch).not.toHaveBeenCalled();
    }
  });

  it('does not write when reopening an item that is already open', async () => {
    const { http, patch } = mockHttp({ type: 'Task', state: 'New' }, AGILE_TASK_STATES);
    await push(http, false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('throws when the type has no completed state', async () => {
    const { http, patch } = mockHttp({ type: 'Odd', state: 'Active' }, [
      { name: 'Active', category: 'InProgress' },
    ]);
    await expect(push(http, true)).rejects.toThrow('ERRORS.NO_TARGET_STATE');
    expect(patch).not.toHaveBeenCalled();
  });

  it('ignores changes without a state', async () => {
    const { http, get } = mockHttp({ type: 'Task', state: 'Active' }, AGILE_TASK_STATES);
    await definition.updateIssue!('7', { title: 'x' }, CFG, http);
    expect(get).not.toHaveBeenCalled();
  });
});
