import { PluginAPI } from '@super-productivity/plugin-api';
import { loadTodoistData } from './load-todoist-data';

describe('loadTodoistData', () => {
  it('follows the initial full sync with an incremental sync and merges the delta', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        sync_token: 'full-token',
        projects: [{ id: 'p1', name: 'Old name' }],
        items: [],
        sections: [],
        notes: [],
      })
      .mockResolvedValueOnce({
        sync_token: 'incremental-token',
        projects: [
          { id: 'p1', name: 'New name' },
          { id: 'p2', name: 'New project' },
        ],
      });

    const result = await loadTodoistData(
      { request } as unknown as Pick<PluginAPI, 'request'>,
      'secret-token',
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(
      new URLSearchParams(request.mock.calls[0][1].body as string).get('sync_token'),
    ).toBe('*');
    expect(
      new URLSearchParams(request.mock.calls[1][1].body as string).get('sync_token'),
    ).toBe('full-token');
    expect(result.sync_token).toBe('incremental-token');
    expect(result.projects?.map((project) => project.name)).toEqual([
      'New name',
      'New project',
    ]);
  });

  it('fails closed when Todoist omits the incremental sync token', async () => {
    const request = jest.fn().mockResolvedValue({ projects: [] });

    await expect(
      loadTodoistData(
        { request } as unknown as Pick<PluginAPI, 'request'>,
        'secret-token',
      ),
    ).rejects.toThrow('sync token');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
