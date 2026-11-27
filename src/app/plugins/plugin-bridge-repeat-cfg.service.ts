import { inject, Injectable } from '@angular/core';
import { PluginTaskRepeatCfgSchedule } from '@super-productivity/plugin-api';
import {
  TaskRepeatCfgWriteResult,
  TaskRepeatCfgWriteService,
} from '../features/task-repeat-cfg/task-repeat-cfg-write.service';
import { PluginLog } from '../core/log';
import { pluginAssert } from './plugin-bridge-asserts';

/** Rejects with the write's error so the plugin sees why nothing changed. */
const unwrap = (result: TaskRepeatCfgWriteResult): string => {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  if (!result.value) {
    // the write dispatched but the config is not in the store
    throw new Error('Repeat config was not saved');
  }
  return result.value.id;
};

/**
 * Plugin API methods that create and change repeat configs, validated the
 * same way as the Local REST API. Split from PluginBridgeService, which is at
 * its size cap.
 */
@Injectable({ providedIn: 'root' })
export class PluginBridgeRepeatCfgService {
  private _writeService = inject(TaskRepeatCfgWriteService);

  createBoundMethods(): Pick<
    PluginBridgeRepeatCfgService,
    'addTaskRepeatCfg' | 'updateTaskRepeatCfg'
  > {
    return {
      addTaskRepeatCfg: (taskId, schedule) => this.addTaskRepeatCfg(taskId, schedule),
      updateTaskRepeatCfg: (repeatCfgId, updates) =>
        this.updateTaskRepeatCfg(repeatCfgId, updates),
    };
  }

  async addTaskRepeatCfg(
    taskId: string,
    schedule: PluginTaskRepeatCfgSchedule = {},
  ): Promise<string> {
    pluginAssert.string(taskId);
    // plugins are untrusted callers: the declared type is not enforced
    const fields: unknown = schedule;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      throw new Error('Repeat config schedule must be an object');
    }
    // the task is the first argument; one in the schedule could redirect it
    if (Object.hasOwn(fields, 'taskId')) {
      throw new Error(
        'UNSUPPORTED_FIELD: Field(s) cannot be set through this endpoint: taskId',
      );
    }
    const id = unwrap(await this._writeService.create({ ...fields, taskId }));
    PluginLog.log('PluginBridge: repeat config added', { taskId, id });
    return id;
  }

  async updateTaskRepeatCfg(
    repeatCfgId: string,
    updates: PluginTaskRepeatCfgSchedule,
  ): Promise<void> {
    pluginAssert.string(repeatCfgId);
    unwrap(await this._writeService.update(repeatCfgId, updates));
    PluginLog.log('PluginBridge: repeat config updated', { id: repeatCfgId });
  }
}
