/**
 * @deprecated LEGACY CODE — do not modify.
 *
 * This is compiled JS from the old PFAPI sync system (TypeScript sources have been removed).
 * It is kept solely for backward-compatibility during migration to the new operation-log
 * sync system (src/app/op-log/). Safe to delete once all users have migrated.
 */
'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
Object.defineProperty(exports, '__esModule', { value: true });
__exportStar(require('./pfapi.model'), exports);
__exportStar(require('./pfapi.const'), exports);
__exportStar(require('./pfapi'), exports);
__exportStar(require('./sync/providers/dropbox/dropbox'), exports);
__exportStar(require('./sync/providers/webdav/webdav'), exports);
__exportStar(require('./sync/sync-provider.interface'), exports);
__exportStar(require('./errors/errors'), exports);
__exportStar(require('./sync/providers/webdav/webdav.model'), exports);
//# sourceMappingURL=index.js.map
