/**
 * @deprecated LEGACY CODE — do not modify.
 *
 * This is compiled JS from the old PFAPI sync system (TypeScript sources have been removed).
 * It is kept solely for backward-compatibility during migration to the new operation-log
 * sync system (src/app/op-log/). Safe to delete once all users have migrated.
 */
'use strict';
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __generator =
  (this && this.__generator) ||
  function (thisArg, body) {
    var _ = {
        label: 0,
        sent: function () {
          if (t[0] & 1) throw t[1];
          return t[1];
        },
        trys: [],
        ops: [],
      },
      f,
      y,
      t,
      g = Object.create((typeof Iterator === 'function' ? Iterator : Object).prototype);
    return (
      (g.next = verb(0)),
      (g['throw'] = verb(1)),
      (g['return'] = verb(2)),
      typeof Symbol === 'function' &&
        (g[Symbol.iterator] = function () {
          return this;
        }),
      g
    );
    function verb(n) {
      return function (v) {
        return step([n, v]);
      };
    }
    function step(op) {
      if (f) throw new TypeError('Generator is already executing.');
      while ((g && ((g = 0), op[0] && (_ = 0)), _))
        try {
          if (
            ((f = 1),
            y &&
              (t =
                op[0] & 2
                  ? y['return']
                  : op[0]
                    ? y['throw'] || ((t = y['return']) && t.call(y), 0)
                    : y.next) &&
              !(t = t.call(y, op[1])).done)
          )
            return t;
          if (((y = 0), t)) op = [op[0] & 2, t.value];
          switch (op[0]) {
            case 0:
            case 1:
              t = op;
              break;
            case 4:
              _.label++;
              return { value: op[1], done: false };
            case 5:
              _.label++;
              y = op[1];
              op = [0];
              continue;
            case 7:
              op = _.ops.pop();
              _.trys.pop();
              continue;
            default:
              if (
                !((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
                (op[0] === 6 || op[0] === 2)
              ) {
                _ = 0;
                continue;
              }
              if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
                _.label = op[1];
                break;
              }
              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1];
                t = op;
                break;
              }
              if (t && _.label < t[2]) {
                _.label = t[2];
                _.ops.push(op);
                break;
              }
              if (t[2]) _.ops.pop();
              _.trys.pop();
              continue;
          }
          op = body.call(thisArg, _);
        } catch (e) {
          op = [6, e];
          y = 0;
        } finally {
          f = t = 0;
        }
      if (op[0] & 5) throw op[1];
      return { value: op[0] ? op[1] : void 0, done: true };
    }
  };
var __values =
  (this && this.__values) ||
  function (o) {
    var s = typeof Symbol === 'function' && Symbol.iterator,
      m = s && o[s],
      i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === 'number')
      return {
        next: function () {
          if (o && i >= o.length) o = void 0;
          return { value: o && o[i++], done: !o };
        },
      };
    throw new TypeError(
      s ? 'Object is not iterable.' : 'Symbol.iterator is not defined.',
    );
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
Object.defineProperty(exports, '__esModule', { value: true });
exports.Pfapi = void 0;
var sync_service_1 = require('./sync/sync.service');
var database_1 = require('./db/database');
var indexed_db_adapter_1 = require('./db/indexed-db-adapter');
var meta_model_ctrl_1 = require('./model-ctrl/meta-model-ctrl');
var model_ctrl_1 = require('./model-ctrl/model-ctrl');
var mini_observable_1 = require('./util/mini-observable');
var log_1 = require('../../core/log');
var encrypt_and_compress_handler_service_1 = require('./sync/encrypt-and-compress-handler.service');
var sync_provider_private_cfg_store_1 = require('./sync/sync-provider-private-cfg-store');
var errors_1 = require('./errors/errors');
var tmp_backup_service_1 = require('./backup/tmp-backup.service');
var promise_timeout_1 = require('../../util/promise-timeout');
var events_1 = require('./util/events');
var migration_service_1 = require('./migration/migration.service');
var Pfapi = /** @class */ (function () {
  function Pfapi(modelCfgs, syncProviders, cfg) {
    var _this = this;
    var _a;
    this.syncProviders = syncProviders;
    this.cfg = cfg;
    this._activeSyncProvider$ = new mini_observable_1.MiniObservable(
      null,
      errors_1.NoSyncProviderSetError,
    );
    this._encryptAndCompressCfg$ = new mini_observable_1.MiniObservable({
      isCompress: false,
      isEncrypt: false,
    });
    this._isSyncInProgress = false;
    this.ev = new events_1.PFEventEmitter();
    this._getAllSyncModelDataRetryCount = 0;
    this.ev.on('syncStart', function (v) {});
    if (Pfapi._wasInstanceCreated) {
      throw new Error(': This should only ever be instantiated once');
    }
    Pfapi._wasInstanceCreated = true;
    this.db = new database_1.Database({
      onError:
        (cfg === null || cfg === void 0 ? void 0 : cfg.onDbError) ||
        function () {
          return undefined;
        },
      adapter:
        (cfg === null || cfg === void 0 ? void 0 : cfg.dbAdapter) ||
        new indexed_db_adapter_1.IndexedDbAdapter({
          // TODO to variable
          dbName: 'pf',
          dbMainName: 'main',
          version: 1,
        }),
    });
    this.tmpBackupService = new tmp_backup_service_1.TmpBackupService(this.db);
    this.metaModel = new meta_model_ctrl_1.MetaModelCtrl(
      this.db,
      this.ev,
      ((_a = this.cfg) === null || _a === void 0 ? void 0 : _a.crossModelVersion) || 0,
    );
    this.m = this._createModels(modelCfgs);
    log_1.PFLog.normal('m', this.m);
    this.syncProviders = syncProviders;
    this.syncProviders.forEach(function (sp) {
      sp.privateCfg = new sync_provider_private_cfg_store_1.SyncProviderPrivateCfgStore(
        sp.id,
        _this.db,
        _this.ev,
      );
    });
    this.migrationService = new migration_service_1.MigrationService(this);
    this._syncService = new sync_service_1.SyncService(
      this.m,
      this,
      this.metaModel,
      this._activeSyncProvider$,
      this._encryptAndCompressCfg$,
      new encrypt_and_compress_handler_service_1.EncryptAndCompressHandlerService(),
    );
    this.wasDataMigratedInitiallyPromise = this.migrationService.checkAndMigrateLocalDB();
  }
  Pfapi.prototype.sync = function () {
    return __awaiter(this, void 0, void 0, function () {
      var _this = this;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            return [
              4 /*yield*/,
              this._wrapSyncAction(''.concat(this.sync.name, '()'), function () {
                return _this._syncService.sync();
              }),
            ];
          case 1:
            return [2 /*return*/, _a.sent()];
        }
      });
    });
  };
  Pfapi.prototype.downloadAll = function () {
    return __awaiter(this, arguments, void 0, function (isSkipRevChange) {
      var _this = this;
      if (isSkipRevChange === void 0) {
        isSkipRevChange = false;
      }
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            return [
              4 /*yield*/,
              this._wrapSyncAction(''.concat(this.downloadAll.name, '()'), function () {
                return _this._syncService.downloadAll(isSkipRevChange);
              }),
            ];
          case 1:
            return [2 /*return*/, _a.sent()];
        }
      });
    });
  };
  Pfapi.prototype.uploadAll = function () {
    return __awaiter(this, arguments, void 0, function (isForceUpload) {
      var _this = this;
      if (isForceUpload === void 0) {
        isForceUpload = false;
      }
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            return [
              4 /*yield*/,
              this._wrapSyncAction(
                ''.concat(this.uploadAll.name, '() f:').concat(isForceUpload),
                function () {
                  return _this._syncService.uploadAll(isForceUpload);
                },
              ),
            ];
          case 1:
            return [2 /*return*/, _a.sent()];
        }
      });
    });
  };
  Pfapi.prototype._wrapSyncAction = function (logPrefix, fn) {
    return __awaiter(this, void 0, void 0, function () {
      var result, e_1;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            // Check if sync is already in progress
            if (this._isSyncInProgress) {
              log_1.PFLog.normal(
                ''.concat(logPrefix, ' SKIPPED - sync already in progress'),
              );
              throw new Error('Sync already in progress');
            }
            // Set sync in progress flag
            this._isSyncInProgress = true;
            // Lock the database during sync to prevent concurrent modifications
            this.db.lock();
            _a.label = 1;
          case 1:
            _a.trys.push([1, 3, 4, 5]);
            log_1.PFLog.normal(''.concat(logPrefix));
            this.ev.emit('syncStatusChange', 'SYNCING');
            return [4 /*yield*/, fn()];
          case 2:
            result = _a.sent();
            log_1.PFLog.normal(''.concat(logPrefix, ' result:'), result);
            this.ev.emit('syncDone', result);
            // Keep lock until after status change to prevent race conditions
            this.ev.emit('syncStatusChange', 'IN_SYNC');
            return [2 /*return*/, result];
          case 3:
            e_1 = _a.sent();
            this.ev.emit('syncError', e_1);
            this.ev.emit('syncDone', e_1);
            this.ev.emit('syncStatusChange', 'ERROR');
            throw e_1;
          case 4:
            // Always unlock the database and clear sync flag, even on error
            this.db.unlock();
            this._isSyncInProgress = false;
            return [7 /*endfinally*/];
          case 5:
            return [2 /*return*/];
        }
      });
    });
  };
  Pfapi.prototype.setActiveSyncProvider = function (activeProviderId) {
    var _this = this;
    log_1.PFLog.normal(
      ''.concat(this.setActiveSyncProvider.name, '()'),
      activeProviderId,
      activeProviderId,
    );
    if (activeProviderId) {
      var provider = this.syncProviders.find(function (sp) {
        return sp.id === activeProviderId;
      });
      if (!provider) {
        log_1.PFLog.log(provider, activeProviderId);
        throw new errors_1.InvalidSyncProviderError();
      }
      this._activeSyncProvider$.next(provider);
      provider.isReady().then(function (isReady) {
        _this.ev.emit('providerReady', isReady);
      });
    } else {
      this.ev.emit('providerReady', false);
      this._activeSyncProvider$.next(null);
    }
  };
  Pfapi.prototype.getActiveSyncProvider = function () {
    return this._activeSyncProvider$.value;
  };
  Pfapi.prototype.getSyncProviderById = function (providerId) {
    return __awaiter(this, void 0, void 0, function () {
      var provider;
      return __generator(this, function (_a) {
        log_1.PFLog.normal(''.concat(this.getSyncProviderById.name, '()'), providerId);
        provider = this.syncProviders.find(function (sp) {
          return sp.id === providerId;
        });
        if (!provider) {
          throw new errors_1.InvalidSyncProviderError();
        }
        // TODO typing
        return [2 /*return*/, provider];
      });
    });
  };
  Pfapi.prototype.getSyncProviderPrivateCfg = function (providerId) {
    return __awaiter(this, void 0, void 0, function () {
      var provider;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            log_1.PFLog.normal(
              ''.concat(this.getSyncProviderPrivateCfg.name, '()'),
              providerId,
            );
            provider = this.syncProviders.find(function (sp) {
              return sp.id === providerId;
            });
            if (!provider) {
              throw new errors_1.InvalidSyncProviderError();
            }
            return [4 /*yield*/, provider.privateCfg.load()];
          case 1:
            // TODO typing
            return [2 /*return*/, _a.sent()];
        }
      });
    });
  };
  // TODO typing
  Pfapi.prototype.setPrivateCfgForSyncProvider = function (providerId, privateCfg) {
    return __awaiter(this, void 0, void 0, function () {
      var provider, _a, _b, _c;
      var _d;
      return __generator(this, function (_e) {
        switch (_e.label) {
          case 0:
            log_1.PFLog.normal(
              ''.concat(this.setPrivateCfgForSyncProvider.name, '()'),
              providerId,
              privateCfg &&
                Object.keys(privateCfg).map(function (k) {
                  return k + ':' + typeof privateCfg[k];
                }),
            );
            provider = this.syncProviders.find(function (sp) {
              return sp.id === providerId;
            });
            if (!provider) {
              throw new errors_1.InvalidSyncProviderError();
            }
            return [4 /*yield*/, provider.setPrivateCfg(privateCfg)];
          case 1:
            _e.sent();
            if (
              !(
                ((_d = this._activeSyncProvider$.value) === null || _d === void 0
                  ? void 0
                  : _d.id) === providerId
              )
            )
              return [3 /*break*/, 3];
            _b = (_a = this.ev).emit;
            _c = ['providerReady'];
            return [4 /*yield*/, this._activeSyncProvider$.value.isReady()];
          case 2:
            _b.apply(_a, _c.concat([_e.sent()]));
            _e.label = 3;
          case 3:
            return [2 /*return*/];
        }
      });
    });
  };
  Pfapi.prototype.setEncryptAndCompressCfg = function (cfg) {
    log_1.PFLog.normal(''.concat(this.setEncryptAndCompressCfg.name, '()'), cfg);
    this._encryptAndCompressCfg$.next(cfg);
  };
  // TODO improve naming with validity check
  Pfapi.prototype.getAllSyncModelData = function () {
    return __awaiter(this, arguments, void 0, function (isSkipValidityCheck) {
      var modelIds, promises, allDataArr, allData, validationResultIfNeeded;
      var _this = this;
      var _a;
      if (isSkipValidityCheck === void 0) {
        isSkipValidityCheck = false;
      }
      return __generator(this, function (_b) {
        switch (_b.label) {
          case 0:
            log_1.PFLog.normal(''.concat(this.getAllSyncModelData.name, '()'));
            modelIds = Object.keys(this.m);
            promises = modelIds.map(function (modelId) {
              var modelCtrl = _this.m[modelId];
              return modelCtrl.load();
            });
            return [4 /*yield*/, Promise.all(promises)];
          case 1:
            allDataArr = _b.sent();
            allData = allDataArr.reduce(function (acc, cur, idx) {
              acc[modelIds[idx]] = cur;
              return acc;
            }, {});
            validationResultIfNeeded =
              !isSkipValidityCheck &&
              ((_a = this.cfg) === null || _a === void 0 ? void 0 : _a.validate) &&
              this.cfg.validate(allData);
            if (!(validationResultIfNeeded && !validationResultIfNeeded.success))
              return [3 /*break*/, 3];
            log_1.PFLog.error('ACTUALLY GOT ONE!!', validationResultIfNeeded);
            if (this._getAllSyncModelDataRetryCount >= 1) {
              log_1.PFLog.error('ACTUALLY GOT ONE 2!! ERROR', validationResultIfNeeded);
              this._getAllSyncModelDataRetryCount = 0;
              throw new errors_1.DataValidationFailedError(validationResultIfNeeded);
            }
            return [4 /*yield*/, (0, promise_timeout_1.promiseTimeout)(1000)];
          case 2:
            _b.sent();
            this._getAllSyncModelDataRetryCount++;
            return [2 /*return*/, this.getAllSyncModelData(isSkipValidityCheck)];
          case 3:
            this._getAllSyncModelDataRetryCount = 0;
            return [2 /*return*/, allData];
        }
      });
    });
  };
  Pfapi.prototype.loadCompleteBackup = function () {
    return __awaiter(this, arguments, void 0, function (isSkipValidityCheck) {
      var d, meta;
      if (isSkipValidityCheck === void 0) {
        isSkipValidityCheck = false;
      }
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            return [4 /*yield*/, this.getAllSyncModelData(isSkipValidityCheck)];
          case 1:
            d = _a.sent();
            return [4 /*yield*/, this.metaModel.load()];
          case 2:
            meta = _a.sent();
            return [
              2 /*return*/,
              {
                data: d,
                crossModelVersion: meta.crossModelVersion,
                lastUpdate: meta.lastUpdate,
                timestamp: Date.now(),
              },
            ];
        }
      });
    });
  };
  Pfapi.prototype.importCompleteBackup = function (backup_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function (backup, isSkipLegacyWarnings, isForceConflict) {
        var newClientId, freshVectorClock;
        var _a;
        if (isSkipLegacyWarnings === void 0) {
          isSkipLegacyWarnings = false;
        }
        if (isForceConflict === void 0) {
          isForceConflict = false;
        }
        return __generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              // First import the data
              return [
                4 /*yield*/,
                this.importAllSycModelData({
                  data: backup.data,
                  crossModelVersion: backup.crossModelVersion,
                  // TODO maybe also make model versions work
                  isBackupData: true,
                  isAttemptRepair: true,
                  isSkipLegacyWarnings: isSkipLegacyWarnings,
                }),
              ];
            case 1:
              // First import the data
              _b.sent();
              if (!isForceConflict) return [3 /*break*/, 4];
              return [4 /*yield*/, this.metaModel.generateNewClientId()];
            case 2:
              newClientId = _b.sent();
              freshVectorClock =
                ((_a = {}),
                // NOTE we set local change count to 2 to avoid MINIMAL_UPDATE_THRESHOLD in getSyncStatusFromMetaFiles()
                (_a[newClientId] = 2),
                _a);
              return [
                4 /*yield*/,
                this.metaModel.save({
                  crossModelVersion: backup.crossModelVersion,
                  lastUpdate: Date.now(),
                  lastSyncedUpdate: null, // No sync history
                  lastSyncedVectorClock: null, // No sync history
                  vectorClock: freshVectorClock,
                  metaRev: null, // No remote rev
                  lastUpdateAction: 'Restored from backup with fresh sync state',
                  revMap: {}, // Will be populated on next save
                }),
              ];
            case 3:
              _b.sent();
              _b.label = 4;
            case 4:
              return [2 /*return*/];
          }
        });
      },
    );
  };
  Pfapi.prototype.importAllSycModelData = function (_a) {
    return __awaiter(this, arguments, void 0, function (_b) {
      var dataAfter,
        validationResult,
        r2,
        _c,
        _d,
        error_1,
        modelIds,
        SKIPPED_MODEL_IDS_1,
        promises,
        e_2,
        backup,
        eII_1;
      var _this = this;
      var _e, _f;
      var data = _b.data,
        crossModelVersion = _b.crossModelVersion,
        _g = _b.isAttemptRepair,
        isAttemptRepair = _g === void 0 ? false : _g,
        _h = _b.isBackupData,
        isBackupData = _h === void 0 ? false : _h,
        _j = _b.isSkipLegacyWarnings,
        isSkipLegacyWarnings = _j === void 0 ? false : _j,
        _k = _b.isBackupImport,
        isBackupImport = _k === void 0 ? false : _k;
      return __generator(this, function (_l) {
        switch (_l.label) {
          case 0:
            log_1.PFLog.normal(''.concat(this.importAllSycModelData.name, '()'), {
              data: data,
              cfg: this.cfg,
            });
            return [4 /*yield*/, this.migrationService.migrate(crossModelVersion, data)];
          case 1:
            dataAfter = _l.sent().dataAfter;
            data = dataAfter;
            if ((_e = this.cfg) === null || _e === void 0 ? void 0 : _e.validate) {
              validationResult = this.cfg.validate(data);
              if (!validationResult.success) {
                log_1.PFLog.critical(
                  ''.concat(this.importAllSycModelData.name, '() data not valid'),
                  validationResult,
                );
                if (isAttemptRepair && this.cfg.repair) {
                  log_1.PFLog.critical(
                    ''.concat(this.importAllSycModelData.name, '() attempting repair'),
                  );
                  data = this.cfg.repair(data, validationResult.errors);
                  r2 = this.cfg.validate(data);
                  if (!r2.success) {
                    throw new errors_1.DataValidationFailedError(r2);
                  }
                } else {
                  throw new errors_1.DataValidationFailedError(validationResult);
                }
              }
            }
            if (!isBackupData) return [3 /*break*/, 6];
            _l.label = 2;
          case 2:
            _l.trys.push([2, 5, , 6]);
            _d = (_c = this.tmpBackupService).save;
            return [4 /*yield*/, this.getAllSyncModelData()];
          case 3:
            return [4 /*yield*/, _d.apply(_c, [_l.sent()])];
          case 4:
            _l.sent();
            return [3 /*break*/, 6];
          case 5:
            error_1 = _l.sent();
            log_1.PFLog.critical(this.importAllSycModelData.name, error_1);
            log_1.PFLog.err(
              'Could not create valid backup. Onwards on the highway throug the Danger Zone!',
            );
            log_1.PFLog.err(error_1);
            return [3 /*break*/, 6];
          case 6:
            _l.trys.push([6, 8, 14, 15]);
            this.db.lock();
            modelIds = Object.keys(data);
            SKIPPED_MODEL_IDS_1 = ['lastLocalSyncModelChange', 'lastArchiveUpdate'];
            promises = modelIds.map(function (modelId) {
              var modelData = data[modelId];
              var modelCtrl = _this.m[modelId];
              if (!modelCtrl) {
                log_1.PFLog.err('ModelId without Ctrl', modelId, modelData);
                if (
                  SKIPPED_MODEL_IDS_1.includes(modelId) ||
                  isSkipLegacyWarnings ||
                  confirm(
                    'ModelId "'.concat(
                      modelId,
                      '" was found in data. The model seems to be outdated. Ignore and proceed to import anyway?',
                    ),
                  )
                ) {
                  return Promise.resolve();
                }
                throw new errors_1.ModelIdWithoutCtrlError(modelId, modelData);
              }
              return modelCtrl.save(modelData, {
                isUpdateRevAndLastUpdate: false,
                isIgnoreDBLock: true,
              });
            });
            return [4 /*yield*/, Promise.all(promises)];
          case 7:
            _l.sent();
            return [3 /*break*/, 15];
          case 8:
            e_2 = _l.sent();
            return [4 /*yield*/, this.tmpBackupService.load()];
          case 9:
            backup = _l.sent();
            if (!(backup && !isBackupImport)) return [3 /*break*/, 13];
            _l.label = 10;
          case 10:
            _l.trys.push([10, 12, , 13]);
            return [
              4 /*yield*/,
              this.importAllSycModelData({
                data: backup,
                crossModelVersion:
                  ((_f = this.cfg) === null || _f === void 0
                    ? void 0
                    : _f.crossModelVersion) || 0,
                isBackupImport: true,
              }),
            ];
          case 11:
            _l.sent();
            return [3 /*break*/, 13];
          case 12:
            eII_1 = _l.sent();
            throw new errors_1.BackupImportFailedError(eII_1);
          case 13:
            throw e_2;
          case 14:
            this.db.unlock();
            return [7 /*endfinally*/];
          case 15:
            if (!isBackupData) return [3 /*break*/, 17];
            return [4 /*yield*/, this.tmpBackupService.clear()];
          case 16:
            _l.sent();
            _l.label = 17;
          case 17:
            return [2 /*return*/];
        }
      });
    });
  };
  Pfapi.prototype.isValidateComplete = function (data) {
    var _a;
    log_1.PFLog.normal(''.concat(this.isValidateComplete.name, '()'), { data: data });
    if (!((_a = this.cfg) === null || _a === void 0 ? void 0 : _a.validate)) {
      throw new errors_1.NoValidateFunctionProvidedError();
    }
    return this.cfg.validate(data).success;
    // we don't do this!!!! => throw new DataValidationFailedError();
  };
  Pfapi.prototype.repairCompleteData = function (data, errors) {
    var _a;
    log_1.PFLog.normal(''.concat(this.repairCompleteData.name, '()'), { data: data });
    if (!((_a = this.cfg) === null || _a === void 0 ? void 0 : _a.repair)) {
      throw new errors_1.NoRepairFunctionProvidedError();
    }
    return this.cfg.repair(data, errors);
  };
  Pfapi.prototype.validate = function (data) {
    var _a;
    log_1.PFLog.normal(''.concat(this.validate.name, '()'), { data: data });
    if (!((_a = this.cfg) === null || _a === void 0 ? void 0 : _a.validate)) {
      throw new errors_1.NoValidateFunctionProvidedError();
    }
    return this.cfg.validate(data);
  };
  Pfapi.prototype._createModels = function (modelCfgs) {
    var e_3, _a;
    var result = {};
    try {
      // TODO validate modelCfgs
      for (
        var _b = __values(Object.entries(modelCfgs)), _c = _b.next();
        !_c.done;
        _c = _b.next()
      ) {
        var _d = __read(_c.value, 2),
          id = _d[0],
          item = _d[1];
        result[id] = new model_ctrl_1.ModelCtrl(id, item, this.db, this.metaModel);
      }
    } catch (e_3_1) {
      e_3 = { error: e_3_1 };
    } finally {
      try {
        if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
      } finally {
        if (e_3) throw e_3.error;
      }
    }
    return result;
  };
  Pfapi._wasInstanceCreated = false;
  return Pfapi;
})();
exports.Pfapi = Pfapi;
//# sourceMappingURL=pfapi.js.map
