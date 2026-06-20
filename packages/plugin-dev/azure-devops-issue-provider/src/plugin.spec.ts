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
