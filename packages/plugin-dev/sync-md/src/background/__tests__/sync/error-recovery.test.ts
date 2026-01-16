import { mdToSp } from '../../sync/md-to-sp';

describe('Error Recovery Integration', () => {
  beforeEach(() => {
    // Mock PluginAPI
    global.PluginAPI = {
      showSnack: jest.fn(),
      getTasks: jest.fn().mockResolvedValue([]),
      getAllProjects: jest
        .fn()
        .mockResolvedValue([{ id: 'test-project', title: 'Test Project' }]),
      batchUpdateForProject: jest.fn().mockResolvedValue({
        success: true,
        createdTaskIds: {},
      }),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should not crash on valid markdown with subtasks', async () => {
    const markdown = `- [ ] <!--parent--> Parent Task
  - [ ] <!--child--> Child Task`;

    // Should not throw and should sync successfully
    await expect(mdToSp(markdown, 'test-project')).resolves.not.toThrow();

    // Should NOT show error notifications for valid markdown
    expect(global.PluginAPI.showSnack).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR' }),
    );
  });

  it('should show error notification on batch operation failure', async () => {
    (global.PluginAPI.batchUpdateForProject as jest.Mock).mockResolvedValue({
      success: false,
      errors: [{ operationIndex: 0, type: 'TASK_NOT_FOUND', message: 'Task not found' }],
    });

    const markdown = `- [ ] Task`;

    await expect(mdToSp(markdown, 'test-project')).rejects.toThrow();

    expect(global.PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ERROR',
        msg: expect.stringContaining('Batch operations failed'),
      }),
    );
  });

  it('should continue plugin operation even after sync errors', async () => {
    const markdown = `- [ ] <!--invalid--> Task with issue`;

    // First call fails
    (global.PluginAPI.batchUpdateForProject as jest.Mock).mockRejectedValueOnce(
      new Error('Network error'),
    );

    await expect(mdToSp(markdown, 'test-project')).rejects.toThrow();

    // Verify error was communicated to user
    expect(global.PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR' }),
    );

    // Plugin should still be functional - second call succeeds
    (global.PluginAPI.batchUpdateForProject as jest.Mock).mockResolvedValueOnce({
      success: true,
      createdTaskIds: {},
    });

    await expect(mdToSp(markdown, 'test-project')).resolves.not.toThrow();
  });
});
