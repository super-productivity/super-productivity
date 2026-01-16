import { mdToSp } from './md-to-sp';
import { spToMd } from './sp-to-md';
import { LocalUserCfg } from '../local-config';
import { Task } from '@super-productivity/plugin-api';
// Import mocked modules
import {
  ensureDirectoryExists,
  writeTasksFile,
  readTasksFile,
} from '../helper/file-utils';

// Mock dependencies
jest.mock('../helper/file-utils');

// Mock the PluginAPI

describe('Header Preservation Integration', () => {
  const mockConfig: LocalUserCfg = {
    filePath: '/test/tasks.md',
    projectId: 'test-project',
  };

  let mockTasks: Task[] = [];
  let mockProjects: any[] = [];
  let mockSyncedData: Record<string, any> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockTasks = [];
    mockProjects = [
      {
        id: 'test-project',
        title: 'Test Project',
        taskIds: [],
      },
    ];
    mockSyncedData = {};

    // Setup PluginAPI mock
    (global as any).PluginAPI = {
      getTasks: jest.fn().mockResolvedValue(mockTasks),
      getAllProjects: jest.fn().mockResolvedValue(mockProjects),
      batchUpdateForProject: jest.fn().mockImplementation(({ operations }) => {
        // Simulate batch operations
        operations.forEach((op: any) => {
          if (op.type === 'ADD_TASK') {
            mockTasks.push(op.task);
          } else if (op.type === 'UPDATE_TASK') {
            const index = mockTasks.findIndex((t) => t.id === op.task.id);
            if (index >= 0) {
              mockTasks[index] = { ...mockTasks[index], ...op.task };
            }
          }
        });
        return Promise.resolve({
          success: true,
          createdTaskIds: {},
        });
      }),
      persistDataSynced: jest.fn().mockImplementation((data) => {
        Object.assign(mockSyncedData, data);
        return Promise.resolve();
      }),
      loadSyncedData: jest.fn().mockResolvedValue(mockSyncedData),
      showSnack: jest.fn(),
    };
  });

  it('should preserve header content through full sync cycle', async () => {
    const markdownWithHeader = `# Project Tasks
This is my project description.

## Important Notes
- Remember to check dependencies
- Update documentation

- [ ] <!--task-1--> Task 1
- [ ] <!--task-2--> Task 2
  - [ ] <!--subtask-1--> Subtask 2.1`;

    // Step 1: Parse markdown and sync to SP
    await mdToSp(markdownWithHeader, mockConfig.projectId);

    // Step 2: Mock the file read to return the original content with header
    (readTasksFile as jest.Mock).mockResolvedValue(markdownWithHeader);

    // Mock file operations
    (ensureDirectoryExists as jest.Mock).mockResolvedValue(undefined);
    (writeTasksFile as jest.Mock).mockResolvedValue(undefined);

    // Setup mock tasks that would have been created from mdToSp
    mockTasks = [
      {
        id: 'task-1',
        title: 'Task 1',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
        subTaskIds: [],
      },
      {
        id: 'task-2',
        title: 'Task 2',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
        subTaskIds: ['subtask-1'],
      },
      {
        id: 'subtask-1',
        title: 'Subtask 2.1',
        isDone: false,
        projectId: 'test-project',
        parentId: 'task-2',
        subTaskIds: [],
      },
    ] as unknown as Task[];

    // Update the mock to return our tasks
    (global as any).PluginAPI.getTasks.mockResolvedValue(mockTasks);

    // Update project to have the task IDs
    mockProjects[0].taskIds = ['task-1', 'task-2'];

    // Step 3: Run spToMd and verify header is preserved
    await spToMd(mockConfig);

    // Verify the written content includes the header
    expect(writeTasksFile).toHaveBeenCalled();
    const writtenContent = (writeTasksFile as jest.Mock).mock.calls[0][1];

    // The content should start with the header
    expect(writtenContent).toMatch(/^# Project Tasks/);
    expect(writtenContent).toContain('This is my project description.');
    expect(writtenContent).toContain('## Important Notes');
    expect(writtenContent).toContain('- Remember to check dependencies');
    expect(writtenContent).toContain('- Update documentation');

    // And should include the tasks
    expect(writtenContent).toContain('- [ ] <!--task-1--> Task 1');
    expect(writtenContent).toContain('- [ ] <!--task-2--> Task 2');
    expect(writtenContent).toContain('  - [ ] <!--subtask-1--> Subtask 2.1');
  });

  it('should handle empty header', async () => {
    const markdownNoHeader = `- [ ] Task 1
- [ ] Task 2`;

    // Mock file operations
    (readTasksFile as jest.Mock).mockResolvedValue(markdownNoHeader);
    (ensureDirectoryExists as jest.Mock).mockResolvedValue(undefined);
    (writeTasksFile as jest.Mock).mockResolvedValue(undefined);

    // Setup mock tasks
    mockTasks = [
      {
        id: 'task-1',
        title: 'Task 1',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
        subTaskIds: [],
      },
      {
        id: 'task-2',
        title: 'Task 2',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
        subTaskIds: [],
      },
    ] as unknown as Task[];

    (global as any).PluginAPI.getTasks.mockResolvedValue(mockTasks);

    // Run spToMd
    await spToMd(mockConfig);

    // Verify no header was added
    const writtenContent = (writeTasksFile as jest.Mock).mock.calls[0][1];
    expect(writtenContent).not.toMatch(/^#/);
    expect(writtenContent).toMatch(/^- \[ \] <!--task-1--> Task 1/);
  });
});
