import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from './action-executor';
import { PluginAPI } from '@super-productivity/plugin-api';
import { AutomationRegistry } from './registry';
import { Action, TaskEvent } from '../types';
import { DataCache } from './data-cache';

describe('ActionExecutor', () => {
  let mockPlugin: PluginAPI;
  let mockRegistry: AutomationRegistry;
  let mockDataCache: DataCache;
  let executor: ActionExecutor;

  beforeEach(() => {
    mockPlugin = {
      log: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      },
    } as unknown as PluginAPI;

    mockRegistry = {
      getAction: vi.fn(),
    } as unknown as AutomationRegistry;

    mockDataCache = {} as DataCache;

    executor = new ActionExecutor(mockPlugin, mockRegistry, mockDataCache);
  });

  it('should execute all provided actions', async () => {
    const mockActionImpl = {
      execute: vi.fn(),
    };
    (mockRegistry.getAction as any).mockReturnValue(mockActionImpl);

    const actions: Action[] = [
      { type: 'createTask', value: 'New Task' },
      { type: 'displaySnack', value: 'Done' },
    ];
    const event = { type: 'taskCompleted' } as TaskEvent;

    await executor.executeAll(actions, event);

    expect(mockRegistry.getAction).toHaveBeenCalledTimes(2);
    expect(mockRegistry.getAction).toHaveBeenCalledWith('createTask');
    expect(mockRegistry.getAction).toHaveBeenCalledWith('displaySnack');
    expect(mockActionImpl.execute).toHaveBeenCalledTimes(2);
  });

  it('should log warning for unknown action type', async () => {
    (mockRegistry.getAction as any).mockReturnValue(undefined);

    const actions: Action[] = [{ type: 'unknownAction' as any, value: '' }];
    const event = { type: 'taskCompleted' } as TaskEvent;

    await executor.executeAll(actions, event);

    expect(mockPlugin.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown action type'),
    );
  });

  it('should log error if action execution fails', async () => {
    const mockActionImpl = {
      execute: vi.fn().mockRejectedValue(new Error('Execution Failed')),
    };
    (mockRegistry.getAction as any).mockReturnValue(mockActionImpl);

    const actions: Action[] = [{ type: 'createTask', value: 'Fail' }];
    const event = { type: 'taskCompleted' } as TaskEvent;

    await executor.executeAll(actions, event);

    expect(mockPlugin.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Action createTask failed'),
    );
  });

  it('should execute deleteTask last regardless of position in actions array', async () => {
    const executionOrder: string[] = [];
    const mockActionImpl = (type: string) => ({
      execute: vi.fn().mockImplementation(async () => {
        executionOrder.push(type);
      }),
    });

    const addTagImpl = mockActionImpl('addTag');
    const deleteTaskImpl = mockActionImpl('deleteTask');
    const displaySnackImpl = mockActionImpl('displaySnack');

    (mockRegistry.getAction as any).mockImplementation((type: string) => {
      if (type === 'addTag') return addTagImpl;
      if (type === 'deleteTask') return deleteTaskImpl;
      if (type === 'displaySnack') return displaySnackImpl;
      return undefined;
    });

    const actions: Action[] = [
      { type: 'deleteTask', value: '' },
      { type: 'addTag', value: 'urgent' },
      { type: 'displaySnack', value: 'Done' },
    ];
    const event = { type: 'taskCompleted' } as TaskEvent;

    await executor.executeAll(actions, event);

    expect(executionOrder).toEqual(['addTag', 'displaySnack', 'deleteTask']);
  });
});
