import typia from 'typia';
import {
  DialogCfg,
  Hooks,
  NotifyCfg,
  PluginCreateTaskData,
  PluginHeaderBtnCfg,
  PluginNodeScriptRequest,
} from './plugin-api.model';
import { BatchUpdateRequest, SnackCfg } from '@super-productivity/plugin-api';
import { TaskCopy } from '../features/tasks/task.model';
import { ProjectCopy } from '../features/project/project.model';
import { TagCopy } from '../features/tag/tag.model';

/**
 * Input validators for PluginBridgeService. typia inlines a full validator at
 * every `typia.assert<T>()` call site, and some (e.g. Partial<ProjectCopy>) are
 * large, so each type gets one shared instance instead of a copy per call site.
 */
export const pluginAssert = {
  string: typia.createAssert<string>(),
  number: typia.createAssert<number>(),
  stringArray: typia.createAssert<string[]>(),
  contextType: typia.createAssert<'project' | 'task'>(),
  snackCfg: typia.createAssert<SnackCfg>(),
  notifyCfg: typia.createAssert<NotifyCfg>(),
  dialogCfg: typia.createAssert<DialogCfg>(),
  partialTask: typia.createAssert<Partial<TaskCopy>>(),
  createTaskData: typia.createAssert<PluginCreateTaskData>(),
  partialProject: typia.createAssert<Partial<ProjectCopy>>(),
  partialTag: typia.createAssert<Partial<TagCopy>>(),
  batchUpdateRequest: typia.createAssert<BatchUpdateRequest>(),
  hook: typia.createAssert<Hooks>(),
  headerBtnCfg: typia.createAssert<Omit<PluginHeaderBtnCfg, 'pluginId'>>(),
  nodeScriptRequest: typia.createAssert<PluginNodeScriptRequest>(),
};
