import { PluginAPI } from '@super-productivity/plugin-api';
import { Condition, TaskEvent } from '../types';
import { DataCache } from './data-cache';

export interface AutomationContext {
  plugin: PluginAPI;
  dataCache: DataCache;
}

export interface IAutomationTrigger {
  id: string; // e.g. 'taskCompleted'
  name: string;
  description?: string;
  // Checks if this trigger matches the incoming event
  matches(event: TaskEvent, value?: string): boolean;
}

export interface IAutomationCondition {
  id: string; // e.g. 'titleContains'
  name: string;
  description?: string;
  check(
    context: AutomationContext,
    event: TaskEvent,
    value?: string,
    condition?: Condition,
  ): Promise<boolean>;
}

export interface IAutomationAction {
  id: string; // e.g. 'createTask'
  name: string;
  description?: string;
  execute(context: AutomationContext, event: TaskEvent, value?: string): Promise<void>;
}

export const TASK_SHARED_ADD_TASK_ACTION = '[Task Shared] addTask';
