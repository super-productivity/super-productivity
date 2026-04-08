import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ActionCreateTask,
  ActionDeleteTask,
  ActionAddTag,
  ActionMoveToProject,
  ActionDisplaySnack,
  ActionDisplayDialog,
  ActionWebhook,
} from './actions';
import { AutomationContext } from './definitions';
import { TaskEvent } from '../types';
import { PluginAPI } from '@super-productivity/plugin-api';
import { DataCache } from './data-cache';

describe('Actions', () => {
  let mockPlugin: PluginAPI;
  let mockContext: AutomationContext;
  let mockDataCache: DataCache;

  beforeEach(() => {
    mockPlugin = {
      addTask: vi.fn(),
      deleteTask: vi.fn(),
      updateTask: vi.fn(),
      getAllTags: vi.fn(),
      showSnack: vi.fn(),
      openDialog: vi.fn(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as PluginAPI;

    mockDataCache = {
      getProjects: vi.fn(),
      getTags: vi.fn(),
    } as unknown as DataCache;

    mockContext = { plugin: mockPlugin, dataCache: mockDataCache };
  });

  describe('ActionCreateTask', () => {
    it('should create a task with the provided title', async () => {
      const event = { task: { projectId: 'p1' } } as TaskEvent;
      await ActionCreateTask.execute(mockContext, event, 'New Task');
      expect(mockPlugin.addTask).toHaveBeenCalledWith({
        title: 'New Task',
        projectId: 'p1',
      });
    });

    it('should not create task if value is empty', async () => {
      const event = {} as TaskEvent;
      await ActionCreateTask.execute(mockContext, event, '');
      expect(mockPlugin.addTask).not.toHaveBeenCalled();
    });
  });

  describe('ActionDeleteTask', () => {
    it('should delete the triggering task', async () => {
      const event = { task: { id: 'task1', title: 'Delete me' } } as TaskEvent;

      await ActionDeleteTask.execute(mockContext, event, '');

      expect(mockPlugin.deleteTask).toHaveBeenCalledWith('task1');
      expect(mockPlugin.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted task "Delete me"'),
      );
    });

    it('should warn if task context is missing', async () => {
      await ActionDeleteTask.execute(mockContext, { task: undefined } as TaskEvent, '');

      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('without task context'),
      );
      expect(mockPlugin.deleteTask).not.toHaveBeenCalled();
    });
  });

  describe('ActionAddTag', () => {
    it('should add a tag if it exists and is not already present', async () => {
      (mockDataCache.getTags as any).mockResolvedValue([{ id: 't1', title: 'Urgent' }]);
      const event = {
        task: { id: 'task1', tagIds: [] },
      } as unknown as TaskEvent;

      await ActionAddTag.execute(mockContext, event, 'Urgent');

      expect(mockPlugin.updateTask).toHaveBeenCalledWith('task1', {
        tagIds: ['t1'],
      });
    });

    it('should warn if task is missing', async () => {
      await ActionAddTag.execute(mockContext, { task: undefined } as TaskEvent, 'Urgent');
      expect(mockPlugin.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('without task context'),
      );
      expect(mockPlugin.updateTask).not.toHaveBeenCalled();
    });

    it('should warn if tag not found', async () => {
      (mockDataCache.getTags as any).mockResolvedValue([]);
      const event = {
        task: { id: 'task1', tagIds: [] },
      } as unknown as TaskEvent;

      await ActionAddTag.execute(mockContext, event, 'NonExistent');
      expect(mockPlugin.log.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(mockPlugin.updateTask).not.toHaveBeenCalled();
    });

    it('should do nothing if tag already present', async () => {
      (mockDataCache.getTags as any).mockResolvedValue([{ id: 't1', title: 'Urgent' }]);
      const event = {
        task: { id: 'task1', tagIds: ['t1'] },
      } as unknown as TaskEvent;

      await ActionAddTag.execute(mockContext, event, 'Urgent');
      expect(mockPlugin.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('ActionMoveToProject', () => {
    it('should move task to project if it exists', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([{ id: 'p1', title: 'Project A' }]);
      const event = {
        task: { id: 'task1', projectId: 'p2' },
      } as unknown as TaskEvent;

      await ActionMoveToProject.execute(mockContext, event, 'Project A');

      expect(mockPlugin.updateTask).toHaveBeenCalledWith('task1', { projectId: 'p1' });
    });

    it('should warn if project not found', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([]);
      const event = {
        task: { id: 'task1', projectId: 'p2' },
      } as unknown as TaskEvent;

      await ActionMoveToProject.execute(mockContext, event, 'NonExistent');
      expect(mockPlugin.log.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(mockPlugin.updateTask).not.toHaveBeenCalled();
    });

    it('should do nothing if task already in project', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([{ id: 'p1', title: 'Project A' }]);
      const event = {
        task: { id: 'task1', projectId: 'p1' },
      } as unknown as TaskEvent;

      await ActionMoveToProject.execute(mockContext, event, 'Project A');
      expect(mockPlugin.updateTask).not.toHaveBeenCalled();
      expect(mockPlugin.log.info).toHaveBeenCalledWith(
        expect.stringContaining('already in project'),
      );
    });

    it('should move task to project if ID is used instead of title', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([{ id: 'p1', title: 'Project A' }]);
      const event = {
        task: { id: 'task1', projectId: 'p2' },
      } as unknown as TaskEvent;

      await ActionMoveToProject.execute(mockContext, event, 'p1');

      expect(mockPlugin.updateTask).toHaveBeenCalledWith('task1', { projectId: 'p1' });
    });
  });

  describe('ActionDisplaySnack', () => {
    it('should show snack', async () => {
      await ActionDisplaySnack.execute(mockContext, {} as TaskEvent, 'Hello');
      expect(mockPlugin.showSnack).toHaveBeenCalledWith({ msg: 'Hello', type: 'SUCCESS' });
    });
  });

  describe('ActionDisplayDialog', () => {
    it('should open dialog', async () => {
      await ActionDisplayDialog.execute(mockContext, {} as TaskEvent, 'Alert');
      expect(mockPlugin.openDialog).toHaveBeenCalledWith(
        expect.objectContaining({ htmlContent: '<p>Alert</p>' }),
      );
    });

    it('should escape HTML special characters', async () => {
      await ActionDisplayDialog.execute(
        mockContext,
        {} as TaskEvent,
        '<script>alert("xss")</script>',
      );
      expect(mockPlugin.openDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          htmlContent: '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>',
        }),
      );
    });
  });

  describe('ActionWebhook', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should send POST request with sanitized task data', async () => {
      const event = {
        type: 'taskCompleted',
        task: {
          id: 't1',
          title: 'Test',
          projectId: 'p1',
          isDone: true,
          tagIds: ['tag1'],
          notes: 'secret notes',
          timeSpent: 12345,
        },
      } as unknown as TaskEvent;
      await ActionWebhook.execute(mockContext, event, 'http://example.com');
      expect(fetch).toHaveBeenCalledWith(
        'http://example.com',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            type: 'taskCompleted',
            task: {
              id: 't1',
              title: 'Test',
              projectId: 'p1',
              isDone: true,
              tagIds: ['tag1'],
            },
          }),
        }),
      );
    });

    it('should log error on fetch failure', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network Error'));
      await ActionWebhook.execute(mockContext, {} as TaskEvent, 'http://example.com');
      expect(mockPlugin.log.error).toHaveBeenCalled();
    });
  });
});
