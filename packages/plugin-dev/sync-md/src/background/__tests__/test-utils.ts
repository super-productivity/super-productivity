import { Task } from '@super-productivity/plugin-api';
import { ParsedTask } from '../sync/markdown-parser';
import { LocalUserCfg } from '../local-config';

/**
 * Test data builders and utilities
 */

export class TaskBuilder {
  private task: Partial<Task> = {
    id: 'default-id',
    title: 'Default Task',
    isDone: false,
    projectId: 'test-project',
    parentId: null,
    subTaskIds: [],
    notes: '',
  };

  withId(id: string): TaskBuilder {
    this.task.id = id;
    return this;
  }

  withTitle(title: string): TaskBuilder {
    this.task.title = title;
    return this;
  }

  withDone(isDone: boolean): TaskBuilder {
    this.task.isDone = isDone;
    return this;
  }

  withParentId(parentId: string | null): TaskBuilder {
    this.task.parentId = parentId;
    return this;
  }

  withSubTaskIds(subTaskIds: string[]): TaskBuilder {
    this.task.subTaskIds = subTaskIds;
    return this;
  }

  withNotes(notes: string): TaskBuilder {
    this.task.notes = notes;
    return this;
  }

  withProjectId(projectId: string): TaskBuilder {
    this.task.projectId = projectId;
    return this;
  }

  build(): Task {
    return this.task as Task;
  }
}

export class ParsedTaskBuilder {
  private task: Partial<ParsedTask> = {
    line: 0,
    indent: 0,
    completed: false,
    id: null,
    title: 'Default Task',
    originalLine: '- [ ] Default Task',
    parentId: null,
    isSubtask: false,
    depth: 0,
  };

  withLine(line: number): ParsedTaskBuilder {
    this.task.line = line;
    return this;
  }

  withIndent(indent: number): ParsedTaskBuilder {
    this.task.indent = indent;
    return this;
  }

  withCompleted(completed: boolean): ParsedTaskBuilder {
    this.task.completed = completed;
    return this;
  }

  withId(id: string | null): ParsedTaskBuilder {
    this.task.id = id;
    return this;
  }

  withTitle(title: string): ParsedTaskBuilder {
    this.task.title = title;
    return this;
  }

  withParentId(parentId: string | null): ParsedTaskBuilder {
    this.task.parentId = parentId;
    return this;
  }

  withIsSubtask(isSubtask: boolean): ParsedTaskBuilder {
    this.task.isSubtask = isSubtask;
    return this;
  }

  withDepth(depth: number): ParsedTaskBuilder {
    this.task.depth = depth;
    return this;
  }

  withNotes(notes: string): ParsedTaskBuilder {
    this.task.notes = notes;
    return this;
  }

  build(): ParsedTask {
    return this.task as ParsedTask;
  }
}

export class MarkdownBuilder {
  private lines: string[] = [];

  addTask(
    title: string,
    options?: {
      completed?: boolean;
      id?: string;
      indent?: number;
    },
  ): MarkdownBuilder {
    const { completed = false, id, indent = 0 } = options || {};
    const checkbox = completed ? '[x]' : '[ ]';
    const idComment = id ? `<!--${id}--> ` : '';
    const indentStr = ' '.repeat(indent);

    this.lines.push(`${indentStr}- ${checkbox} ${idComment}${title}`);
    return this;
  }

  addNote(content: string, indent: number = 2): MarkdownBuilder {
    const indentStr = ' '.repeat(indent);
    this.lines.push(`${indentStr}${content}`);
    return this;
  }

  addEmptyLine(): MarkdownBuilder {
    this.lines.push('');
    return this;
  }

  addText(text: string): MarkdownBuilder {
    this.lines.push(text);
    return this;
  }

  build(): string {
    return this.lines.join('\n');
  }
}

export const createMockConfig = (overrides?: Partial<LocalUserCfg>): LocalUserCfg => ({
  filePath: '/test/tasks.md',
  projectId: 'test-project',
  ...overrides,
});

export const createMockPluginAPI = (): any => {
  const mockAPI = {
    registerHook: jest.fn(),
    onWindowFocusChange: jest.fn(),
    getTasks: jest.fn().mockResolvedValue([]),
    getAllProjects: jest
      .fn()
      .mockResolvedValue([{ id: 'test-project', title: 'Test Project' }]),
    batchUpdateForProject: jest.fn().mockResolvedValue({
      success: true,
      createdTaskIds: {},
    }),
    log: {
      critical: jest.fn(),
      err: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      normal: jest.fn(),
      info: jest.fn(),
      verbose: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    },
    persistDataSynced: jest.fn(),
    loadSyncedData: jest.fn(),
    showSnack: jest.fn(),
  };

  (global as any).PluginAPI = mockAPI;
  return mockAPI;
};

export const createTaskHierarchy = (config: {
  parentCount: number;
  childrenPerParent: number;
  startId?: number;
}): Task[] => {
  const { parentCount, childrenPerParent, startId = 0 } = config;
  const tasks: Task[] = [];
  let id = startId;

  for (let p = 0; p < parentCount; p++) {
    const parentId = `parent-${id++}`;
    const childIds: string[] = [];

    // Create children first to get their IDs
    for (let c = 0; c < childrenPerParent; c++) {
      childIds.push(`child-${id++}`);
    }

    // Create parent
    tasks.push(
      new TaskBuilder()
        .withId(parentId)
        .withTitle(`Parent ${p}`)
        .withSubTaskIds(childIds)
        .build(),
    );

    // Create children
    childIds.forEach((childId, index) => {
      tasks.push(
        new TaskBuilder()
          .withId(childId)
          .withTitle(`Child ${index} of Parent ${p}`)
          .withParentId(parentId)
          .build(),
      );
    });
  }

  return tasks;
};

export const generateLargeMarkdown = (taskCount: number): string => {
  const builder = new MarkdownBuilder();

  for (let i = 0; i < taskCount; i++) {
    builder.addTask(`Task ${i}`, {
      id: `task-${i}`,
      completed: i % 3 === 0,
      indent: (i % 5) * 2, // Vary indentation
    });

    if (i % 10 === 0) {
      builder.addNote('This is a note for the task');
    }
  }

  return builder.build();
};

export const waitForAsync = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export const measureExecutionTime = async (
  fn: () => void | Promise<void>,
): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

/**
 * Custom Jest matchers
 */
export const customMatchers = {
  toBeValidTask: (received: any) => {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.title === 'string' &&
      typeof received.isDone === 'boolean' &&
      typeof received.projectId === 'string';

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid task`
          : `expected ${received} to be a valid task with id, title, isDone, and projectId`,
    };
  },

  toBeValidParsedTask: (received: any) => {
    const pass =
      received &&
      typeof received.line === 'number' &&
      typeof received.indent === 'number' &&
      typeof received.completed === 'boolean' &&
      typeof received.title === 'string';

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid parsed task`
          : `expected ${received} to be a valid parsed task with line, indent, completed, and title`,
    };
  },
};
