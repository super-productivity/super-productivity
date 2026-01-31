/**
 * @deprecated LEGACY CODE — do not modify.
 *
 * This is compiled JS from the old PFAPI sync system (TypeScript sources have been removed).
 * It is kept solely for backward-compatibility during migration to the new operation-log
 * sync system (src/app/op-log/). Safe to delete once all users have migrated.
 */
'use strict';
var __assign =
  (this && this.__assign) ||
  function () {
    __assign =
      Object.assign ||
      function (t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
      };
    return __assign.apply(this, arguments);
  };
var __read =
  (this && this.__read) ||
  function (o, n) {
    var m = typeof Symbol === 'function' && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o),
      r,
      ar = [],
      e;
    try {
      while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    } catch (error) {
      e = { error: error };
    } finally {
      try {
        if (r && !r.done && (m = i['return'])) m.call(i);
      } finally {
        if (e) throw e.error;
      }
    }
    return ar;
  };
var __spreadArray =
  (this && this.__spreadArray) ||
  function (to, from, pack) {
    if (pack || arguments.length === 2)
      for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
        }
      }
    return to.concat(ar || Array.prototype.slice.call(from));
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.PFAPI_CFG =
  exports.PFAPI_SYNC_PROVIDERS =
  exports.fileSyncDroid =
  exports.fileSyncElectron =
  exports.PFAPI_MODEL_CFGS =
  exports.CROSS_MODEL_VERSION =
    void 0;
var api_1 = require('./api');
var planner_reducer_1 = require('../features/planner/store/planner.reducer');
var boards_reducer_1 = require('../features/boards/store/boards.reducer');
var project_reducer_1 = require('../features/project/store/project.reducer');
var default_global_config_const_1 = require('../features/config/default-global-config.const');
var note_reducer_1 = require('../features/note/store/note.reducer');
var issue_provider_reducer_1 = require('../features/issue/store/issue-provider.reducer');
var metric_reducer_1 = require('../features/metric/store/metric.reducer');
var improvement_reducer_1 = require('../features/metric/improvement/store/improvement.reducer');
var obstruction_reducer_1 = require('../features/metric/obstruction/store/obstruction.reducer');
var task_reducer_1 = require('../features/tasks/store/task.reducer');
var tag_reducer_1 = require('../features/tag/store/tag.reducer');
var simple_counter_reducer_1 = require('../features/simple-counter/store/simple-counter.reducer');
var task_repeat_cfg_reducer_1 = require('../features/task-repeat-cfg/store/task-repeat-cfg.reducer');
var dropbox_const_1 = require('../imex/sync/dropbox/dropbox.const');
var webdav_1 = require('./api/sync/providers/webdav/webdav');
var is_data_repair_possible_util_1 = require('./repair/is-data-repair-possible.util');
var is_related_model_data_valid_1 = require('./validate/is-related-model-data-valid');
var data_repair_1 = require('./repair/data-repair');
var local_file_sync_electron_1 = require('./api/sync/providers/local-file-sync/local-file-sync-electron');
var app_constants_1 = require('../app.constants');
var is_android_web_view_1 = require('../util/is-android-web-view');
var local_file_sync_android_1 = require('./api/sync/providers/local-file-sync/local-file-sync-android');
var environment_1 = require('../../environments/environment');
var time_tracking_reducer_1 = require('../features/time-tracking/store/time-tracking.reducer');
var cross_model_migrations_1 = require('./migrate/cross-model-migrations');
var validation_fn_1 = require('./validate/validation-fn');
var check_fix_entity_state_consistency_1 = require('../util/check-fix-entity-state-consistency');
var log_1 = require('../core/log');
var plugin_persistence_model_1 = require('../plugins/plugin-persistence.model');
var menu_tree_reducer_1 = require('../features/menu-tree/store/menu-tree.reducer');
exports.CROSS_MODEL_VERSION = 4.4;
exports.PFAPI_MODEL_CFGS = {
  task: {
    defaultData: task_reducer_1.initialTaskState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.task,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  timeTracking: {
    defaultData: time_tracking_reducer_1.initialTimeTrackingState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.timeTracking,
  },
  project: {
    defaultData: project_reducer_1.initialProjectState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.project,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  tag: {
    defaultData: tag_reducer_1.initialTagState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.tag,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  simpleCounter: {
    defaultData: simple_counter_reducer_1.initialSimpleCounterState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.simpleCounter,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  note: {
    defaultData: note_reducer_1.initialNoteState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.note,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  taskRepeatCfg: {
    defaultData: task_repeat_cfg_reducer_1.initialTaskRepeatCfgState,
    // TODO check if still necessary
    // needs to be due to last creation data being saved to model
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.taskRepeatCfg,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  reminders: {
    defaultData: [],
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.reminders,
  },
  planner: {
    defaultData: planner_reducer_1.plannerInitialState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.planner,
  },
  boards: {
    defaultData: boards_reducer_1.initialBoardsState,
    isMainFileModel: true,
    validate: validation_fn_1.appDataValidators.boards,
  },
  // we put it in main file model because it is likely as notes to get changed
  menuTree: {
    defaultData: menu_tree_reducer_1.menuTreeInitialState,
    validate: validation_fn_1.appDataValidators.menuTree,
  },
  //-------------------------------
  pluginUserData: {
    defaultData: plugin_persistence_model_1.initialPluginUserDataState,
    validate: validation_fn_1.appDataValidators.pluginUserData,
  },
  pluginMetadata: {
    defaultData: plugin_persistence_model_1.initialPluginMetaDataState,
    validate: validation_fn_1.appDataValidators.pluginMetadata,
  },
  //-------------------------------
  globalConfig: {
    defaultData: default_global_config_const_1.DEFAULT_GLOBAL_CONFIG,
    validate: validation_fn_1.appDataValidators.globalConfig,
  },
  issueProvider: {
    defaultData: issue_provider_reducer_1.issueProviderInitialState,
    validate: validation_fn_1.appDataValidators.issueProvider,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  // Metric models
  metric: {
    defaultData: metric_reducer_1.initialMetricState,
    validate: validation_fn_1.appDataValidators.metric,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  improvement: {
    defaultData: improvement_reducer_1.initialImprovementState,
    validate: validation_fn_1.appDataValidators.improvement,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  obstruction: {
    defaultData: obstruction_reducer_1.initialObstructionState,
    validate: validation_fn_1.appDataValidators.obstruction,
    repair: check_fix_entity_state_consistency_1.fixEntityStateConsistency,
  },
  archiveYoung: {
    defaultData: {
      task: { ids: [], entities: {} },
      timeTracking: time_tracking_reducer_1.initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    validate: validation_fn_1.appDataValidators.archiveYoung,
    repair: function (d) {
      return __assign(__assign({}, d), {
        task: (0, check_fix_entity_state_consistency_1.fixEntityStateConsistency)(d.task),
      });
    },
  },
  archiveOld: {
    defaultData: {
      task: { ids: [], entities: {} },
      timeTracking: time_tracking_reducer_1.initialTimeTrackingState,
      lastTimeTrackingFlush: 0,
    },
    validate: validation_fn_1.appDataValidators.archiveOld,
    repair: function (d) {
      return __assign(__assign({}, d), {
        task: (0, check_fix_entity_state_consistency_1.fixEntityStateConsistency)(d.task),
      });
    },
  },
};
exports.fileSyncElectron = new local_file_sync_electron_1.LocalFileSyncElectron();
exports.fileSyncDroid = new local_file_sync_android_1.LocalFileSyncAndroid();
exports.PFAPI_SYNC_PROVIDERS = __spreadArray(
  __spreadArray(
    [
      new api_1.Dropbox({
        appKey: dropbox_const_1.DROPBOX_APP_KEY,
        basePath: environment_1.environment.production ? '/' : '/DEV/',
      }),
      new webdav_1.Webdav(environment_1.environment.production ? undefined : '/DEV'),
    ],
    __read(app_constants_1.IS_ELECTRON ? [exports.fileSyncElectron] : []),
    false,
  ),
  __read(is_android_web_view_1.IS_ANDROID_WEB_VIEW ? [exports.fileSyncDroid] : []),
  false,
);
exports.PFAPI_CFG = {
  crossModelVersion: exports.CROSS_MODEL_VERSION,
  validate: function (data) {
    // console.time('validateAllData');
    var r = (0, validation_fn_1.validateAllData)(data);
    if (!environment_1.environment.production && !r.success) {
      log_1.PFLog.log(r);
      alert('VALIDATION ERROR ');
    }
    // console.time('relatedDataValidation');
    if (r.success && !(0, is_related_model_data_valid_1.isRelatedModelDataValid)(data)) {
      return {
        success: false,
        data: data,
        errors: [
          {
            expected:
              (0, is_related_model_data_valid_1.getLastValidityError)() ||
              'Valid Cross Model Relations',
            path: '.',
            value: data,
          },
        ],
      };
    }
    // console.timeEnd('relatedDataValidation');
    // console.timeEnd('validateAllData');
    return r;
  },
  onDbError: function (err) {
    log_1.PFLog.err(err);
    alert('DB ERROR: ' + err);
  },
  repair: function (data, errors) {
    if (!(0, is_data_repair_possible_util_1.isDataRepairPossible)(data)) {
      throw new api_1.DataRepairNotPossibleError(data);
    }
    return (0, data_repair_1.dataRepair)(data, errors);
  },
  crossModelMigrations: cross_model_migrations_1.CROSS_MODEL_MIGRATIONS,
};
//# sourceMappingURL=pfapi-config.js.map
