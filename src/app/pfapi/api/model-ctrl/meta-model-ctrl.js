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
Object.defineProperty(exports, '__esModule', { value: true });
exports.MetaModelCtrl = exports.DEFAULT_META_MODEL = void 0;
var log_1 = require('../../../core/log');
var get_environment_id_1 = require('../util/get-environment-id');
var pfapi_const_1 = require('../pfapi.const');
var errors_1 = require('../errors/errors');
var validate_local_meta_1 = require('../util/validate-local-meta');
var dev_error_1 = require('../../../util/dev-error');
var vector_clock_1 = require('../util/vector-clock');
exports.DEFAULT_META_MODEL = {
  crossModelVersion: 1,
  revMap: {},
  lastUpdate: 0,
  metaRev: null,
  lastSyncedUpdate: null,
  vectorClock: {},
  lastSyncedVectorClock: null,
};
/**
 * Manages metadata for model synchronization and versioning.
 * Handles client identification and provides meta information for the synchronization process.
 */
var MetaModelCtrl = /** @class */ (function () {
  /**
   * Creates a new MetaModelCtrl instance
   *
   * @param _db Database instance for storage operations
   * @param _ev Event emitter for broadcasting model changes
   * @param crossModelVersion The cross-model version number
   */
  function MetaModelCtrl(_db, _ev, crossModelVersion) {
    var _this = this;
    this._db = _db;
    this._ev = _ev;
    this.crossModelVersion = crossModelVersion;
    //
    this._initClientId();
    this.load().then(function (v) {
      _this._metaModelInMemory = v;
    });
  }
  /**
   * Updates the revision for a specific model
   *
   * @param modelId The ID of the model to update
   * @param modelCfg Configuration for the model
   * @param isIgnoreDBLock Whether to ignore database locks
   * @throws {MetaNotReadyError} When metamodel is not loaded yet
   */
  MetaModelCtrl.prototype.updateRevForModel = function (modelId_1, modelCfg_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function (modelId, modelCfg, isIgnoreDBLock) {
        var metaModel,
          timestamp,
          clientId,
          actionStr,
          lastUpdateAction,
          currentVectorClock,
          newVectorClock,
          updatedMeta;
        var _a;
        if (isIgnoreDBLock === void 0) {
          isIgnoreDBLock = false;
        }
        return __generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              log_1.PFLog.normal(
                ''.concat(MetaModelCtrl.L, '.').concat(this.updateRevForModel.name, '()'),
                modelId,
                {
                  modelCfg: modelCfg,
                  inMemory: this._metaModelInMemory,
                },
              );
              if (modelCfg.isLocalOnly) {
                return [2 /*return*/];
              }
              metaModel = this._getMetaModelOrThrow(modelId, modelCfg);
              timestamp = Date.now();
              return [4 /*yield*/, this.loadClientId()];
            case 1:
              clientId = _b.sent();
              // Log to debug vector clock updates
              log_1.PFLog.normal(
                ''
                  .concat(MetaModelCtrl.L, '.')
                  .concat(this.updateRevForModel.name, '() vector clock update'),
                {
                  modelId: modelId,
                  clientId: clientId,
                  currentVectorClock: metaModel.vectorClock,
                  clientIdInMemory: this._clientIdInMemory,
                },
              );
              actionStr = ''
                .concat(modelId, ' => ')
                .concat(new Date(timestamp).toISOString());
              lastUpdateAction =
                actionStr.length > 100 ? actionStr.substring(0, 97) + '...' : actionStr;
              currentVectorClock = metaModel.vectorClock || {};
              newVectorClock = (0, vector_clock_1.incrementVectorClock)(
                currentVectorClock,
                clientId,
              );
              // Apply size limiting to prevent unbounded growth
              newVectorClock = (0, vector_clock_1.limitVectorClockSize)(
                newVectorClock,
                clientId,
              );
              updatedMeta = __assign(
                __assign(
                  __assign(__assign({}, metaModel), {
                    lastUpdate: timestamp,
                    lastUpdateAction: lastUpdateAction,
                    vectorClock: newVectorClock,
                  }),
                  modelCfg.isMainFileModel
                    ? {}
                    : {
                        revMap: __assign(
                          __assign({}, metaModel.revMap),
                          ((_a = {}), (_a[modelId] = timestamp.toString()), _a),
                        ),
                      },
                ),
                {
                  // as soon as we save a related model, we are using the local crossModelVersion (while other updates might be from importing remote data)
                  crossModelVersion: this.crossModelVersion,
                },
              );
              return [4 /*yield*/, this.save(updatedMeta, isIgnoreDBLock)];
            case 2:
              _b.sent();
              return [2 /*return*/];
          }
        });
      },
    );
  };
  /**
   * Saves the metamodel to storage
   *
   * @param metaModel The metamodel to save
   * @param isIgnoreDBLock Whether to ignore database locks
   * @returns Promise that resolves when the save completes
   * @throws {InvalidMetaError} When metamodel is invalid
   */
  MetaModelCtrl.prototype.save = function (metaModel, isIgnoreDBLock) {
    var _this = this;
    if (isIgnoreDBLock === void 0) {
      isIgnoreDBLock = false;
    }
    log_1.PFLog.normal(''.concat(MetaModelCtrl.L, '.').concat(this.save.name, '()'), {
      metaModel: metaModel,
      lastSyncedUpdate: metaModel.lastSyncedUpdate,
      lastUpdate: metaModel.lastUpdate,
      isIgnoreDBLock: isIgnoreDBLock,
    });
    // NOTE: in order to not mess up separate model updates started at the same time, we need to update synchronously as well
    this._metaModelInMemory = (0, validate_local_meta_1.validateLocalMeta)(metaModel);
    this._ev.emit('metaModelChange', metaModel);
    this._ev.emit('syncStatusChange', 'UNKNOWN_OR_CHANGED');
    // Add detailed logging before saving
    log_1.PFLog.normal(
      ''.concat(MetaModelCtrl.L, '.').concat(this.save.name, '() about to save to DB:'),
      {
        id: MetaModelCtrl.META_MODEL_ID,
        lastSyncedUpdate: metaModel.lastSyncedUpdate,
        lastUpdate: metaModel.lastUpdate,
        willMatch: metaModel.lastSyncedUpdate === metaModel.lastUpdate,
      },
    );
    var savePromise = this._db.save(
      MetaModelCtrl.META_MODEL_ID,
      metaModel,
      isIgnoreDBLock,
    );
    // Log after save completes
    savePromise
      .then(function () {
        log_1.PFLog.normal(
          ''
            .concat(MetaModelCtrl.L, '.')
            .concat(_this.save.name, '() DB save completed successfully'),
          metaModel,
        );
      })
      .catch(function (error) {
        (0, dev_error_1.devError)('DB save for meta file failed');
        log_1.PFLog.critical(
          ''.concat(MetaModelCtrl.L, '.').concat(_this.save.name, '() DB save failed'),
          error,
        );
      });
    return savePromise;
  };
  /**
   * Loads the metamodel from storage
   *
   * @returns Promise that resolves to the loaded metamodel
   * @throws {InvalidMetaError} When loaded data is invalid
   */
  MetaModelCtrl.prototype.load = function () {
    return __awaiter(this, void 0, void 0, function () {
      var data;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            log_1.PFLog.verbose(
              ''.concat(MetaModelCtrl.L, '.').concat(this.load.name, '()'),
              this._metaModelInMemory,
            );
            if (this._metaModelInMemory) {
              return [2 /*return*/, this._metaModelInMemory];
            }
            return [4 /*yield*/, this._db.load(MetaModelCtrl.META_MODEL_ID)];
          case 1:
            data = _a.sent();
            // Add debug logging
            log_1.PFLog.normal(
              ''
                .concat(MetaModelCtrl.L, '.')
                .concat(this.load.name, '() loaded from DB:'),
              {
                data: data,
                hasData: !!data,
                lastSyncedUpdate:
                  data === null || data === void 0 ? void 0 : data.lastSyncedUpdate,
                lastUpdate: data === null || data === void 0 ? void 0 : data.lastUpdate,
              },
            );
            // Initialize if not found
            if (!data) {
              this._metaModelInMemory = __assign(
                __assign({}, exports.DEFAULT_META_MODEL),
                { crossModelVersion: this.crossModelVersion },
              );
              log_1.PFLog.normal(
                ''
                  .concat(MetaModelCtrl.L, '.')
                  .concat(this.load.name, '() initialized with defaults'),
              );
              return [2 /*return*/, this._metaModelInMemory];
            }
            if (!data.revMap) {
              throw new errors_1.InvalidMetaError('loadMetaModel: revMap not found');
            }
            // Log the loaded data
            log_1.PFLog.normal(
              ''
                .concat(MetaModelCtrl.L, '.')
                .concat(this.load.name, '() loaded valid data:'),
              {
                lastUpdate: data.lastUpdate,
                lastSyncedUpdate: data.lastSyncedUpdate,
                metaRev: data.metaRev,
                hasRevMap: !!data.revMap,
                revMapKeys: Object.keys(data.revMap || {}),
                vectorClock: data.vectorClock,
                lastSyncedVectorClock: data.lastSyncedVectorClock,
                hasVectorClock: !!data.vectorClock,
                vectorClockKeys: data.vectorClock ? Object.keys(data.vectorClock) : [],
              },
            );
            // Ensure vector clock fields are initialized for old data
            if (data.vectorClock === undefined) {
              data.vectorClock = {};
              log_1.PFLog.normal(
                ''
                  .concat(MetaModelCtrl.L, '.')
                  .concat(this.load.name, '() initialized missing vectorClock'),
              );
            }
            if (data.lastSyncedVectorClock === undefined) {
              data.lastSyncedVectorClock = null;
              log_1.PFLog.normal(
                ''
                  .concat(MetaModelCtrl.L, '.')
                  .concat(this.load.name, '() initialized missing lastSyncedVectorClock'),
              );
            }
            this._metaModelInMemory = data;
            return [2 /*return*/, data];
        }
      });
    });
  };
  /**
   * Loads the client ID from storage
   *
   * @returns Promise that resolves to the client ID
   * @throws {ClientIdNotFoundError} When client ID is not found
   */
  MetaModelCtrl.prototype.loadClientId = function () {
    return __awaiter(this, void 0, void 0, function () {
      var clientId;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            if (this._clientIdInMemory) {
              return [2 /*return*/, this._clientIdInMemory];
            }
            return [4 /*yield*/, this._db.load(MetaModelCtrl.CLIENT_ID)];
          case 1:
            clientId = _a.sent();
            if (typeof clientId !== 'string') {
              throw new errors_1.ClientIdNotFoundError();
            }
            // Validate clientId format to catch corruption
            // Accept old format (10+ chars) and compact format (e.g., "B_FXMz")
            var isOldFormat = clientId.length >= 10;
            var isNewFormat = /^[BEAI]_[a-zA-Z0-9]{4}$/.test(clientId);
            if (!isOldFormat && !isNewFormat) {
              log_1.PFLog.critical(
                ''.concat(MetaModelCtrl.L, '.loadClientId() Invalid clientId loaded:'),
                {
                  clientId: clientId,
                  length: clientId.length,
                },
              );
              throw new Error('Invalid clientId loaded: '.concat(clientId));
            }
            this._clientIdInMemory = clientId;
            log_1.PFLog.normal(''.concat(MetaModelCtrl.L, '.loadClientId() loaded:'), {
              clientId: clientId,
            });
            return [2 /*return*/, clientId];
        }
      });
    });
  };
  /**
   * Initializes the client ID
   */
  MetaModelCtrl.prototype._initClientId = function () {
    return __awaiter(this, void 0, void 0, function () {
      var e_1, clientId;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            _a.trys.push([0, 2, , 6]);
            return [4 /*yield*/, this.loadClientId()];
          case 1:
            _a.sent();
            return [3 /*break*/, 6];
          case 2:
            e_1 = _a.sent();
            if (!(e_1 instanceof errors_1.ClientIdNotFoundError)) return [3 /*break*/, 4];
            clientId = this._generateClientId();
            log_1.PFLog.normal(
              ''.concat(MetaModelCtrl.L, ' Create clientId ').concat(clientId),
            );
            return [4 /*yield*/, this._saveClientId(clientId)];
          case 3:
            _a.sent();
            return [3 /*break*/, 5];
          case 4:
            log_1.PFLog.critical(
              ''.concat(MetaModelCtrl.L, ' Error initializing clientId:'),
              e_1,
            );
            _a.label = 5;
          case 5:
            return [3 /*break*/, 6];
          case 6:
            return [2 /*return*/];
        }
      });
    });
  };
  /**
   * Gets the metamodel or throws an error if not ready
   */
  MetaModelCtrl.prototype._getMetaModelOrThrow = function (modelId, modelCfg) {
    var metaModel = this._metaModelInMemory;
    if (!metaModel) {
      throw new errors_1.MetaNotReadyError(modelId, modelCfg);
    }
    return metaModel;
  };
  /**
   * Saves the client ID to storage
   *
   * @param clientId Client ID to save
   * @returns Promise that resolves when the save completes
   */
  MetaModelCtrl.prototype._saveClientId = function (clientId) {
    log_1.PFLog.normal(
      ''.concat(MetaModelCtrl.L, '.').concat(this._saveClientId.name, '()'),
      clientId,
    );
    this._clientIdInMemory = clientId;
    return this._db.save(MetaModelCtrl.CLIENT_ID, clientId, true);
  };
  /**
   * Generates a new client ID
   *
   * @returns Generated client ID
   */
  MetaModelCtrl.prototype.generateNewClientId = function () {
    return __awaiter(this, void 0, void 0, function () {
      var newClientId;
      return __generator(this, function (_a) {
        switch (_a.label) {
          case 0:
            newClientId = this._generateClientId();
            // Save the new client ID
            return [
              4 /*yield*/,
              this._db.save(MetaModelCtrl.CLIENT_ID, newClientId, true),
            ];
          case 1:
            // Save the new client ID
            _a.sent();
            log_1.PFLog.error(
              ''.concat(
                MetaModelCtrl.L,
                '.generateNewClientId() generated new client ID',
              ),
              {
                newClientId: newClientId,
              },
            );
            return [2 /*return*/, newClientId];
        }
      });
    });
  };
  MetaModelCtrl.prototype._generateClientId = function () {
    log_1.PFLog.normal(
      ''.concat(MetaModelCtrl.L, '.').concat(this._generateClientId.name, '()'),
    );
    var now = new Date();
    var prefix = (0, get_environment_id_1.getEnvironmentId)(); // e.g., "BCL"
    var monthDay = ''.concat(now.getMonth() + 1, '_').concat(now.getDate());
    var millisSinceEpoch = now.getTime();
    var base36Ts = millisSinceEpoch.toString(36); // precise + compact
    return ''.concat(prefix).concat(base36Ts).concat(monthDay);
  };
  MetaModelCtrl.L = 'MetaModelCtrl';
  MetaModelCtrl.META_MODEL_ID = pfapi_const_1.DBNames.MetaModel;
  MetaModelCtrl.META_MODEL_REMOTE_FILE_NAME = pfapi_const_1.DBNames.MetaModel;
  MetaModelCtrl.CLIENT_ID = pfapi_const_1.DBNames.ClientId;
  MetaModelCtrl.META_FILE_LOCK_CONTENT_PREFIX = 'SYNC_IN_PROGRESS__';
  return MetaModelCtrl;
})();
exports.MetaModelCtrl = MetaModelCtrl;
//# sourceMappingURL=meta-model-ctrl.js.map
