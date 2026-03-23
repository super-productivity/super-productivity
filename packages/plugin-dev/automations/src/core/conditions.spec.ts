import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConditionTitleContains, ConditionProjectIs, ConditionHasTag } from './conditions';
import { AutomationContext } from './definitions';
import { TaskEvent } from '../types';
import { DataCache } from './data-cache';

describe('Conditions', () => {
  let mockPlugin: any;
  let mockContext: AutomationContext;
  let mockDataCache: DataCache;

  beforeEach(() => {
    mockPlugin = {
      getAllProjects: vi.fn(),
      getAllTags: vi.fn(),
    };

    mockDataCache = {
      getProjects: vi.fn(),
      getTags: vi.fn(),
    } as unknown as DataCache;

    mockContext = {
      plugin: mockPlugin,
      dataCache: mockDataCache,
    } as unknown as AutomationContext;
  });

  describe('ConditionTitleContains', () => {
    it('should return true when title contains value (case insensitive)', async () => {
      const event = {
        task: { title: 'Buy Milk' },
      } as unknown as TaskEvent;

      expect(await ConditionTitleContains.check(mockContext, event, 'milk')).toBe(true);
      expect(await ConditionTitleContains.check(mockContext, event, 'BUY')).toBe(true);
    });

    it('should return false when title does not contain value', async () => {
      const event = {
        task: { title: 'Buy Milk' },
      } as unknown as TaskEvent;

      expect(await ConditionTitleContains.check(mockContext, event, 'bread')).toBe(false);
    });

    it('should return false when task is missing', async () => {
      const event = { task: undefined } as unknown as TaskEvent;
      expect(await ConditionTitleContains.check(mockContext, event, 'milk')).toBe(false);
    });

    it('should return false when task title is undefined', async () => {
      const event = {
        task: { title: undefined },
      } as unknown as TaskEvent;
      expect(await ConditionTitleContains.check(mockContext, event, 'milk')).toBe(false);
    });

    it('should return false when task title is null', async () => {
      const event = {
        task: { title: null },
      } as unknown as TaskEvent;
      expect(await ConditionTitleContains.check(mockContext, event, 'milk')).toBe(false);
    });
  });

  describe('ConditionProjectIs', () => {
    it('should return true when project title matches', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([
        { id: 'p1', title: 'Work' },
        { id: 'p2', title: 'Home' },
      ]);

      const event = {
        task: { projectId: 'p1' },
      } as unknown as TaskEvent;

      expect(await ConditionProjectIs.check(mockContext, event, 'Work')).toBe(true);
    });

    it('should return false when project title does not match', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([{ id: 'p1', title: 'Work' }]);
      const event = {
        task: { projectId: 'p1' },
      } as unknown as TaskEvent;

      expect(await ConditionProjectIs.check(mockContext, event, 'Home')).toBe(false);
    });

    it('should return false when task has no project', async () => {
      (mockDataCache.getProjects as any).mockResolvedValue([{ id: 'p1', title: 'Work' }]);
      const event = {
        task: { projectId: null },
      } as unknown as TaskEvent;

      expect(await ConditionProjectIs.check(mockContext, event, 'Work')).toBe(false);
    });
  });

  describe('ConditionHasTag', () => {
    it('should return true when task has the tag', async () => {
      (mockDataCache.getTags as any).mockResolvedValue([{ id: 't1', title: 'Urgent' }]);
      const event = {
        task: { tagIds: ['t1', 't2'] },
      } as unknown as TaskEvent;

      expect(await ConditionHasTag.check(mockContext, event, 'Urgent')).toBe(true);
    });

    it('should return false when task does not have the tag', async () => {
      (mockDataCache.getTags as any).mockResolvedValue([{ id: 't1', title: 'Urgent' }]);
      const event = {
        task: { tagIds: ['t2'] },
      } as unknown as TaskEvent;

      expect(await ConditionHasTag.check(mockContext, event, 'Urgent')).toBe(false);
    });
  });
});
