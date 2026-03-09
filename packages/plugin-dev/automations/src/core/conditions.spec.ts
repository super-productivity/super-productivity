import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConditionTitleContains,
  ConditionTitleStartsWith,
  ConditionProjectIs,
  ConditionHasTag,
} from './conditions';
import { AutomationContext } from './definitions';
import { Condition, TaskEvent } from '../types';
import { DataCache } from './data-cache';

describe('Conditions', () => {
  let mockPlugin: any;
  let mockContext: AutomationContext;
  let mockDataCache: DataCache;

  beforeEach(() => {
    mockPlugin = {
      getAllProjects: vi.fn(),
      getAllTags: vi.fn(),
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
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

    it('should support regex matching when enabled', async () => {
      const event = {
        task: { title: 'Bug: broken sync' },
      } as unknown as TaskEvent;
      const regexCondition: Condition = {
        type: 'titleContains',
        value: '^bug:\\s+broken',
        isRegex: true,
      };

      expect(
        await ConditionTitleContains.check(
          mockContext,
          event,
          regexCondition.value,
          regexCondition,
        ),
      ).toBe(true);
    });

    it('should fail closed for invalid regex patterns', async () => {
      const event = {
        task: { title: 'Bug: broken sync' },
      } as unknown as TaskEvent;
      const regexCondition: Condition = { type: 'titleContains', value: '[', isRegex: true };

      expect(
        await ConditionTitleContains.check(
          mockContext,
          event,
          regexCondition.value,
          regexCondition,
        ),
      ).toBe(false);
      expect(mockPlugin.log.warn).toHaveBeenCalled();
    });
  });

  describe('ConditionTitleStartsWith', () => {
    it('should return true when title starts with value (case insensitive)', async () => {
      const event = {
        task: { title: 'Buy Milk' },
      } as unknown as TaskEvent;

      expect(await ConditionTitleStartsWith.check(mockContext, event, 'buy')).toBe(true);
      expect(await ConditionTitleStartsWith.check(mockContext, event, 'BUY')).toBe(true);
    });

    it('should return false when title does not start with value', async () => {
      const event = {
        task: { title: 'Buy Milk' },
      } as unknown as TaskEvent;

      expect(await ConditionTitleStartsWith.check(mockContext, event, 'milk')).toBe(false);
    });

    it('should return false when task is missing', async () => {
      const event = { task: undefined } as unknown as TaskEvent;
      expect(await ConditionTitleStartsWith.check(mockContext, event, 'buy')).toBe(false);
    });

    it('should support regex matching anchored to the start when enabled', async () => {
      const event = {
        task: { title: 'Bug: broken sync' },
      } as unknown as TaskEvent;
      const regexCondition: Condition = {
        type: 'titleStartsWith',
        value: 'bug:\\s+broken',
        isRegex: true,
      };

      expect(
        await ConditionTitleStartsWith.check(
          mockContext,
          event,
          regexCondition.value,
          regexCondition,
        ),
      ).toBe(true);
      expect(
        await ConditionTitleStartsWith.check(mockContext, event, 'broken', {
          type: 'titleStartsWith',
          value: 'broken',
          isRegex: true,
        }),
      ).toBe(false);
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
