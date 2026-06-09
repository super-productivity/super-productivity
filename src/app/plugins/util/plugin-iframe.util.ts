import { PluginBridgeService } from '../plugin-bridge.service';
import { PluginBaseCfg, PluginManifest } from '../plugin-api.model';
import { PluginHooks, PluginIframeMessageType } from '@super-productivity/plugin-api';
import { PluginLog } from '../../core/log';
import { PLUGIN_UI_KIT_CSS } from './plugin-ui-kit.css';

/**
 * Simplified plugin iframe utilities following KISS principles.
 * One way to do things, no complex options.
 */

export interface PluginIframeConfig {
  pluginId: string;
  manifest: PluginManifest;
  indexHtml: string;
  baseCfg: PluginBaseCfg;
  pluginBridge: PluginBridgeService;
  bridgeToken: string;
  bridgeGeneration: number;
  boundMethods?: ReturnType<typeof PluginBridgeService.prototype.createBoundMethods>;
}

// Keep iframe plugin UIs on an opaque origin. `allow-same-origin` would let blob
// iframes access `window.parent.ea` and bypass the filtered postMessage bridge.
export const PLUGIN_IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-modals';

const ALLOWED_IFRAME_API_METHODS = new Set([
  'getTasks',
  'getArchivedTasks',
  'getCurrentContextTasks',
  'selectTask',
  'reInitData',
  'updateTask',
  'addTask',
  'deleteTask',
  'batchUpdateForProject',
  'reorderTasks',
  'getAllProjects',
  'addProject',
  'updateProject',
  'getAllTags',
  'addTag',
  'updateTag',
  'showSnack',
  'notify',
  'translate',
  'formatDate',
  'getCurrentLanguage',
  'openDialog',
  'showIndexHtmlAsView',
  'showIndexHtmlInSidePanel',
  'showInWorkContext',
  'closeWorkContextView',
  'getActiveWorkContext',
  'getAppState',
  'persistDataSynced',
  'loadPersistedData',
  'registerHook',
  'registerWorkContextHeaderButton',
  'executeNodeScript',
  'dispatchAction',
  'setCounter',
  'getCounter',
  'incrementCounter',
  'decrementCounter',
  'deleteCounter',
  'getAllCounters',
]);

const isTransparentCssValue = (value: string): boolean => {
  const normalized = value.trim().replace(/\s+/g, '').toLowerCase();
  if (!normalized || normalized === 'transparent') {
    return true;
  }
  if (/^#[\da-f]{3}0$/.test(normalized) || /^#[\da-f]{6}00$/.test(normalized)) {
    return true;
  }
  if (/^.+\/0(?:\.0+)?%?\)$/.test(normalized)) {
    return true;
  }
  return /^(?:rgba?|hsla?)\([^,]+,[^,]+,[^,]+,0(?:\.0+)?%?\)$/.test(normalized);
};

const getPluginSurfaceVar = (
  preferredSurface: string,
  fallbackSurface: string,
  baseSurface: string,
): string => {
  if (!isTransparentCssValue(preferredSurface)) {
    return preferredSurface;
  }
  return isTransparentCssValue(fallbackSurface) ? baseSurface : fallbackSurface;
};

const HAS_DIALOG_BUTTON_HANDLER = '__hasDialogButtonHandler';

/**
 * Create CSS injection for plugins - KISS approach
 */
export const createPluginCssInjection = (): string => {
  const isDarkTheme = document.body.classList.contains('isDarkTheme');
  // CSS variables are defined on body, not :root!
  const computedStyle = getComputedStyle(document.body);

  // Just get the essential theme variables we need
  const getVar = (name: string): string => {
    return computedStyle.getPropertyValue(name).trim();
  };
  const bg = getVar('--bg');
  const bgLighter = getVar('--bg-lighter');
  const cardBg = getPluginSurfaceVar(getVar('--card-bg'), bgLighter, bg);

  return `
    <style id="injected-theme-vars">
      :root {
        --bg: ${bg};
        --bg-darker: ${getVar('--bg-darker')};
        --bg-lighter: ${bgLighter};
        --text-color: ${getVar('--text-color')};
        --text-color-less-intense: ${getVar('--text-color-less-intense')};
        --text-color-muted: ${getVar('--text-color-muted')};
        --card-bg: ${cardBg};
        --card-shadow: ${getVar('--card-shadow')};
        --card-border-radius: ${getVar('--card-border-radius')};
        --divider-color: ${getVar('--divider-color')};
        --extra-border-color: ${getVar('--extra-border-color')};
        --select-hover-bg: ${getVar('--select-hover-bg')};
        --c-primary: ${getVar('--c-primary')};
        --c-accent: ${getVar('--c-accent')};
        --c-warn: ${getVar('--c-warn')};
        --color-success: ${getVar('--color-success')};
        --color-danger: ${getVar('--color-danger')};
        --color-warning: ${getVar('--color-warning')};
        --is-dark-theme: ${isDarkTheme ? '1' : '0'};
        --scrollbar-thumb: ${getVar('--scrollbar-thumb')};
        --scrollbar-thumb-hover: ${getVar('--scrollbar-thumb-hover')};
        --scrollbar-track: ${getVar('--scrollbar-track')};

        /* Shadow system */
        --whiteframe-shadow-1dp: ${getVar('--whiteframe-shadow-1dp')};
        --whiteframe-shadow-2dp: ${getVar('--whiteframe-shadow-2dp')};
        --whiteframe-shadow-3dp: ${getVar('--whiteframe-shadow-3dp')};
        --whiteframe-shadow-4dp: ${getVar('--whiteframe-shadow-4dp')};
        --whiteframe-shadow-6dp: ${getVar('--whiteframe-shadow-6dp')};
        --whiteframe-shadow-8dp: ${getVar('--whiteframe-shadow-8dp')};
        --whiteframe-shadow-12dp: ${getVar('--whiteframe-shadow-12dp')};
        --whiteframe-shadow-24dp: ${getVar('--whiteframe-shadow-24dp')};

        /* Spacing system */
        --s: ${getVar('--s')};
        --s-quarter: ${getVar('--s-quarter')};
        --s-half: ${getVar('--s-half')};
        --s2: ${getVar('--s2')};
        --s3: ${getVar('--s3')};
        --s4: ${getVar('--s4')};

        /* Transition system */
        --transition-duration-xs: ${getVar('--transition-duration-xs')};
        --transition-duration-s: ${getVar('--transition-duration-s')};
        --transition-duration-m: ${getVar('--transition-duration-m')};
        --transition-duration-l: ${getVar('--transition-duration-l')};
        --transition-standard: ${getVar('--transition-standard')};
        --ani-standard-timing: ${getVar('--ani-standard-timing')};

        /* Font stack */
        --font-primary-stack: ${getVar('--font-primary-stack')};

        /* Task-related variables */
        --task-first-line-min-height: ${getVar('--task-first-line-min-height')};
        --task-icon-default-opacity: ${getVar('--task-icon-default-opacity')};
        --task-inner-padding-top-bottom: ${getVar('--task-inner-padding-top-bottom')};
        --task-is-done-dim-opacity: ${getVar('--task-is-done-dim-opacity')};
        --task-border-radius: ${getVar('--task-border-radius')};
        --task-c-bg: ${getVar('--task-c-bg')};
        --task-c-selected-bg: ${getVar('--task-c-selected-bg')};
        --sub-task-c-bg: ${getVar('--sub-task-c-bg')};
        --sub-task-c-bg-done: ${getVar('--sub-task-c-bg-done')};
        --task-c-bg-done: ${getVar('--task-c-bg-done')};
        --task-c-current-bg: ${getVar('--task-c-current-bg')};
        --task-c-drag-drop-bg: ${getVar('--task-c-drag-drop-bg')};
        --sub-task-c-bg-in-selected: ${getVar('--sub-task-c-bg-in-selected')};
        --task-shadow: ${getVar('--task-shadow')};
        --task-shadow-sub-task: ${getVar('--task-shadow-sub-task')};
        --task-current-shadow: ${getVar('--task-current-shadow')};
        --task-selected-shadow: ${getVar('--task-selected-shadow')};
        --task-detail-value-color: ${getVar('--task-detail-value-color')};
        --task-detail-bg: ${getVar('--task-detail-bg')};
        --task-detail-bg-hover: ${getVar('--task-detail-bg-hover')};
        --task-detail-shadow: ${getVar('--task-detail-shadow')};
      }

      body {
        background: transparent;
        color: var(--text-color);
        font-family: var(--font-primary-stack);
      }

      /* Custom scrollbar styles for plugins */
      :root {
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
        scrollbar-width: thin;
      }

      ::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }

      /* Track */
      ::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
        border-radius: 4px;
      }

      /* Handle */
      ::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 16px;
      }

      /* Handle on hover */
      ::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
      }
    </style>
  `;
};

/**
 * Create the plugin API script - simple and direct
 */
export const createPluginApiScript = (config: PluginIframeConfig): string => {
  return `
    <script>
      (function() {
        let callId = 0;
        const bridgeToken = ${JSON.stringify(config.bridgeToken)};
        const bridgeGeneration = ${JSON.stringify(config.bridgeGeneration)};
        const pendingCalls = new Map();
        const dialogButtonHandlers = new Map();
        const hookHandlers = new Map(); // Store hook handlers by hook type
        const workContextBtnHandlers = new Map(); // button label -> onClick

        // Handle responses from parent
        window.addEventListener('message', function(event) {
          // Accept messages only from the host (our parent window).
          // Without this check, any other iframe / sibling window could
          // spoof API responses, hook events, or work-context button
          // clicks. The host always posts via the iframe's contentWindow,
          // so event.source will be window.parent in the legitimate case.
          if (event.source !== window.parent) return;
          const data = event.data;
          if (data?.type === '${PluginIframeMessageType.API_RESPONSE}' && data.callId) {
            const resolver = pendingCalls.get(data.callId);
            if (resolver) {
              pendingCalls.delete(data.callId);
              resolver.resolve(data.result);
            }
          } else if (data?.type === '${PluginIframeMessageType.API_ERROR}' && data.callId) {
            const resolver = pendingCalls.get(data.callId);
            if (resolver) {
              pendingCalls.delete(data.callId);
              resolver.reject(new Error(data.error));
            }
          } else if (data?.type === '${PluginIframeMessageType.DIALOG_BUTTON_CLICK}') {
            // Handle dialog button clicks
            const key = data.dialogCallId + ':' + data.buttonIndex;
            const handler = dialogButtonHandlers.get(key);
            if (handler) {
              Promise.resolve()
                .then(() => handler())
                .then((result) => {
                  window.parent.postMessage({
                    type: '${PluginIframeMessageType.DIALOG_BUTTON_RESPONSE}',
                    bridgeToken: bridgeToken,
                    bridgeGeneration: bridgeGeneration,
                    dialogCallId: data.dialogCallId,
                    buttonIndex: data.buttonIndex,
                    result: result
                  }, '*');
                })
                .catch((error) => {
                  window.parent.postMessage({
                    type: '${PluginIframeMessageType.DIALOG_BUTTON_RESPONSE}',
                    bridgeToken: bridgeToken,
                    bridgeGeneration: bridgeGeneration,
                    dialogCallId: data.dialogCallId,
                    buttonIndex: data.buttonIndex,
                    error: error instanceof Error ? error.message : 'Unknown dialog button error'
                  }, '*');
                });
            }
          } else if (data?.type === '${PluginIframeMessageType.WORK_CONTEXT_BTN_CLICK}') {
            const handler = workContextBtnHandlers.get(data.buttonHandlerId);
            if (handler) {
              try {
                handler(data.ctx);
              } catch (error) {
                console.error('Plugin work-context button handler error:', error);
              }
            }
          } else if (data?.type === '${PluginIframeMessageType.HOOK_EVENT}') {
            // Handle hook events
            const handlers = hookHandlers.get(data.hook);
            if (handlers && handlers.length > 0) {
              handlers.forEach(handler => {
                try {
                  handler(data.payload);
                } catch (error) {
                  PluginLog.err('Hook handler error:', error);
                }
              });
            }
          }
        });

        // Simple API call function
        function callApi(method, args) {
          return new Promise((resolve, reject) => {
            const id = ++callId;
            pendingCalls.set(id, { resolve, reject });

            // Special handling for openDialog to store button handlers
            let processedArgs = args;
            if (method === 'openDialog' && args && args[0] && args[0].buttons) {
              processedArgs = [...args];
              processedArgs[0] = {
                ...args[0],
                buttons: args[0].buttons.map((button, index) => {
                  if (button.onClick) {
                    // Store the handler
                    const key = id + ':' + index;
                    dialogButtonHandlers.set(key, button.onClick);
                    // Remove onClick from serialized data
                    const { onClick, ...buttonWithoutHandler } = button;
                    return { ...buttonWithoutHandler, ${HAS_DIALOG_BUTTON_HANDLER}: true };
                  }
                  return button;
                })
              };
            }

            // Special handling for registerHook to store handlers locally
            if (method === 'registerHook' && args && args.length >= 2) {
              const [hook, handler] = args;
              if (typeof handler === 'function') {
                // Store handler locally
                if (!hookHandlers.has(hook)) {
                  hookHandlers.set(hook, []);
                }
                hookHandlers.get(hook).push(handler);

                // Pass a placeholder to parent - parent will send events back to us
                processedArgs = [hook, 'IFRAME_HANDLER'];
              } else {
                processedArgs = args;
              }
            }

            window.parent.postMessage({
              type: '${PluginIframeMessageType.API_CALL}',
              bridgeToken: bridgeToken,
              bridgeGeneration: bridgeGeneration,
              method: method,
              args: processedArgs || [],
              callId: id
            }, '*');

            // Timeout after 30 seconds
            setTimeout(() => {
              if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error('API call timeout'));
              }
            }, 30000);
          });
        }

        function unsupportedIframeRegistration(method) {
          return () => Promise.reject(
            new Error(method + ' is only supported in plugin.js, not iframe index.html')
          );
        }

        // Create the PluginAPI object with all methods
        window.PluginAPI = {
          cfg: ${JSON.stringify(config.baseCfg)},

          // Add Hooks enum (kept in sync with PluginHooks via JSON.stringify
          // of the real source — no hand-edited mirror to drift).
          Hooks: ${JSON.stringify({ ...PluginHooks })},

          // Task methods
          getTasks: () => callApi('getTasks'),
          getArchivedTasks: () => callApi('getArchivedTasks'),
          getCurrentContextTasks: () => callApi('getCurrentContextTasks'),
          selectTask: (taskId) => callApi('selectTask', [taskId]),
          reInitData: () => callApi('reInitData'),
          updateTask: (taskId, updates) => callApi('updateTask', [taskId, updates]),
          addTask: (taskData) => callApi('addTask', [taskData]),
          deleteTask: (taskId) => callApi('deleteTask', [taskId]),
          batchUpdateForProject: (request) => callApi('batchUpdateForProject', [request]),

          // Project methods
          getAllProjects: () => callApi('getAllProjects'),
          addProject: (projectData) => callApi('addProject', [projectData]),
          updateProject: (projectId, updates) => callApi('updateProject', [projectId, updates]),

          // Tag methods
          getAllTags: () => callApi('getAllTags'),
          addTag: (tagData) => callApi('addTag', [tagData]),
          updateTag: (tagId, updates) => callApi('updateTag', [tagId, updates]),

          // Task ordering
          reorderTasks: (taskIds, contextId, contextType) => callApi('reorderTasks', [taskIds, contextId, contextType]),

          // UI methods
          showSnack: (cfg) => callApi('showSnack', [cfg]),
          notify: (cfg) => callApi('notify', [cfg]),
          openDialog: (cfg) => callApi('openDialog', [cfg]),
          showIndexHtmlAsView: () => callApi('showIndexHtmlAsView'),
          showIndexHtmlInSidePanel: () => callApi('showIndexHtmlInSidePanel'),
          showInWorkContext: () => callApi('showInWorkContext'),
          closeWorkContextView: () => callApi('closeWorkContextView'),
          getActiveWorkContext: () => callApi('getActiveWorkContext'),
          getAppState: () => callApi('getAppState'),

          // Persistence methods (optional second arg = key, forwarded by callApi)
          persistDataSynced: (data, key) => callApi('persistDataSynced', [data, key]),
          loadPersistedData: (key) => callApi('loadPersistedData', [key]),
          loadSyncedData: (key) => callApi('loadPersistedData', [key]), // Alias

          // Registration methods
          registerHook: (hook, handler) => callApi('registerHook', [hook, handler]),
          registerHeaderButton: unsupportedIframeRegistration('registerHeaderButton'),
          registerMenuEntry: unsupportedIframeRegistration('registerMenuEntry'),
          registerConfigHandler: unsupportedIframeRegistration('registerConfigHandler'),
          registerShortcut: unsupportedIframeRegistration('registerShortcut'),
          registerSidePanelButton: unsupportedIframeRegistration('registerSidePanelButton'),
          registerWorkContextHeaderButton: (cfg) => {
            // onClick is not structured-cloneable across postMessage; keep it
            // locally, keyed by the button's label, and send the rest of the
            // cfg. The host rebuilds onClick as a proxy and posts a
            // WORK_CONTEXT_BTN_CLICK back (carrying the label) on invocation.
            // Keying by label — which the host also dedups on — means
            // re-registering a button overwrites instead of leaking.
            workContextBtnHandlers.set(cfg.label, cfg.onClick);
            const { onClick, ...rest } = cfg;
            return callApi('registerWorkContextHeaderButton', [rest]);
          },

          // Node execution (if available)
          executeNodeScript: (request) => callApi('executeNodeScript', [request]),

          // Action dispatch
          dispatchAction: (action) => callApi('dispatchAction', [action]),

          // Simple counters
          setCounter: (id, value) => callApi('setCounter', [id, value]),
          getCounter: (id) => callApi('getCounter', [id]),
          incrementCounter: (id, incrementBy) => callApi('incrementCounter', [id, incrementBy]),
          decrementCounter: (id, decrementBy) => callApi('decrementCounter', [id, decrementBy]),
          deleteCounter: (id) => callApi('deleteCounter', [id]),
          getAllCounters: () => callApi('getAllCounters'),

          // i18n
          translate: (key, params) => callApi('translate', [key, params]),
          formatDate: (date, format) => callApi('formatDate', [date, format]),
          getCurrentLanguage: () => callApi('getCurrentLanguage'),

          // Readiness signal for iframe plugins.
          //
          // NOTE — semantic difference from host-side onReady:
          // The host implementation pings the Electron IPC bridge with retry before
          // firing the callback (handles cold-boot races for nodeExecution plugins).
          // Here, we just fire on the next microtask. This is acceptable because:
          //   1. Iframe plugins are rendered on user navigation, long after host
          //      startup — the cold-boot window has already passed.
          //   2. executeNodeScript calls in iframe plugins proxy through the host
          //      via callApi(); the host applies its own ping logic per call site.
          // If iframe plugins ever auto-render at startup, route this through a
          // host-side RPC that calls PluginService._fireOnReady.
          onReady: (fn) => {
            queueMicrotask(() => {
              try {
                Promise.resolve(fn()).catch((err) => {
                  console.error('[Plugin] onReady callback error:', err);
                });
              } catch (err) {
                console.error('[Plugin] onReady callback error:', err);
              }
            });
          },

          // Message handling
          onMessage: (handler) => {
            // Store the handler and set up message listener
            window.__pluginMessageHandler = handler;
            window.addEventListener('message', async (event) => {
              // Same origin-check rationale as the listener above —
              // accept only messages from our parent host.
              if (event.source !== window.parent) return;
              if (event.data?.type === '${PluginIframeMessageType.MESSAGE}' && window.__pluginMessageHandler) {
                try {
                  const result = await window.__pluginMessageHandler(event.data.message);
                  event.source?.postMessage({
                    type: '${PluginIframeMessageType.MESSAGE_RESPONSE}',
                    messageId: event.data.messageId,
                    result
                  }, '*');
                } catch (error) {
                  event.source?.postMessage({
                    type: '${PluginIframeMessageType.MESSAGE_ERROR}',
                    messageId: event.data.messageId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                  }, '*');
                }
              }
            });
          }
        };

        // Notify parent that plugin is ready
        window.parent.postMessage({
          type: '${PluginIframeMessageType.READY}',
          bridgeToken: bridgeToken,
          bridgeGeneration: bridgeGeneration,
          pluginId: '${config.pluginId}'
        }, '*');
      })();
    </script>
  `;
};

// Store blob URLs for cleanup
const activeBlobUrls = new Set<string>();

/**
 * Create iframe URL with injected API using blob URLs instead of data URLs
 */
export const createPluginIframeUrl = (config: PluginIframeConfig): string => {
  const apiScript = createPluginApiScript(config);
  const cssInjection = createPluginCssInjection();
  const fullCssInjection =
    cssInjection + (config.manifest.uiKit !== false ? PLUGIN_UI_KIT_CSS : '');

  // Inject CSS at start of head so plugin styles come later and win by source order
  let html = config.indexHtml;
  const headMatch = html.match(/<head[^>]*>/i);

  if (headMatch) {
    const insertPos = headMatch.index! + headMatch[0].length;
    html = html.slice(0, insertPos) + fullCssInjection + html.slice(insertPos);
  } else {
    // If no head tag, inject at beginning
    html = fullCssInjection + html;
  }

  // Inject API script before closing body tag
  const bodyEnd = html.toLowerCase().lastIndexOf('</body>');

  if (bodyEnd !== -1) {
    html = html.slice(0, bodyEnd) + apiScript + html.slice(bodyEnd);
  } else {
    html = html + apiScript;
  }

  // Create blob URL instead of data URL
  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  // Track the blob URL for cleanup
  activeBlobUrls.add(blobUrl);

  return blobUrl;
};

/**
 * Clean up a blob URL when iframe is no longer needed
 */
export const cleanupPluginIframeUrl = (url: string): void => {
  if (url.startsWith('blob:') && activeBlobUrls.has(url)) {
    URL.revokeObjectURL(url);
    activeBlobUrls.delete(url);
  }
};

/**
 * Clean up all active blob URLs (useful for cleanup on destroy)
 */
export const cleanupAllPluginIframeUrls = (): void => {
  activeBlobUrls.forEach((url) => {
    URL.revokeObjectURL(url);
  });
  activeBlobUrls.clear();
};

/**
 * Handle plugin iframe messages - simple switch statement
 */
export const handlePluginMessage = async (
  event: MessageEvent,
  config: PluginIframeConfig,
): Promise<void> => {
  const { data } = event;

  if (!data || typeof data !== 'object') return;
  if (!isValidBridgeMessage(data, config)) return;

  // Ensure we have bound methods
  if (!config.boundMethods) {
    config.boundMethods = config.pluginBridge.createBoundMethods(
      config.pluginId,
      config.manifest,
    );
  }

  // Handle API calls
  if (data.type === PluginIframeMessageType.API_CALL && data.callId) {
    const { method, args = [], callId } = data;

    try {
      if (!ALLOWED_IFRAME_API_METHODS.has(method)) {
        throw new Error(`Unknown API method: ${method}`);
      }

      // For iframe plugins, we need to handle API calls differently
      // Some methods need special handling because the bridge methods have different signatures

      // registerWorkContextHeaderButton: the iframe keeps its onClick
      // locally, keyed by the button label; rebuild onClick here as a proxy
      // that posts WORK_CONTEXT_BTN_CLICK back into the iframe, where the
      // real handler is looked up by that same label.
      if (method === 'registerWorkContextHeaderButton' && args.length >= 1) {
        const rawCfg = args[0] as Record<string, unknown>;
        const handlerId = rawCfg.label;
        if (typeof handlerId !== 'string' || !handlerId) {
          throw new Error('registerWorkContextHeaderButton requires a string label');
        }
        const wrappedCfg = {
          ...rawCfg,
          onClick: (ctx: unknown): void => {
            (event.source as Window)?.postMessage(
              {
                type: PluginIframeMessageType.WORK_CONTEXT_BTN_CLICK,
                buttonHandlerId: handlerId,
                ctx,
              },
              '*',
            );
          },
        };
        const boundMethods = config.boundMethods as Record<string, unknown>;
        const fn = boundMethods.registerWorkContextHeaderButton as (
          c: unknown,
        ) => unknown;
        const result = await fn(wrappedCfg);
        event.source?.postMessage(
          {
            type: PluginIframeMessageType.API_RESPONSE,
            callId,
            result,
          },
          { targetOrigin: '*' },
        );
        return;
      }

      // For registerHook, we need to add the pluginId parameter when calling the bridge
      if (method === 'registerHook') {
        const bridge = config.pluginBridge as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        // Special handling for registerHook - it needs pluginId as first parameter
        if (args.length >= 2) {
          const [hook, handlerPlaceholder] = args;
          PluginLog.log('Plugin iframe registerHook:', {
            hook,
            handlerPlaceholder,
            pluginId: config.pluginId,
          });

          let result;
          // If it's an iframe handler, create a proxy that sends events to iframe
          if (handlerPlaceholder === 'IFRAME_HANDLER') {
            const handler = (payload: unknown): void => {
              // Send hook event to iframe
              (event.source as Window)?.postMessage(
                {
                  type: PluginIframeMessageType.HOOK_EVENT,
                  hook: hook,
                  payload: payload,
                },
                '*' as const,
              );
            };
            result = await bridge.registerHook(config.pluginId, hook, handler);
          } else {
            throw new Error('Iframe registerHook calls must use IFRAME_HANDLER');
          }
          event.source?.postMessage(
            {
              type: PluginIframeMessageType.API_RESPONSE,
              callId,
              result,
            },
            { targetOrigin: '*' },
          );
          return;
        }
      }

      // Check if this method is available in bound methods
      const boundMethods = config.boundMethods as Record<string, unknown>;
      if (boundMethods && typeof boundMethods[method] === 'function') {
        // Use the bound method
        const result = await (boundMethods[method] as (...args: unknown[]) => unknown)(
          ...(args || []),
        );
        (event.source as Window)?.postMessage(
          {
            type: PluginIframeMessageType.API_RESPONSE,
            callId,
            result,
          },
          '*',
        );
        return;
      }

      // For other methods, call them on the bridge
      const bridge = config.pluginBridge as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >;
      if (typeof bridge[method] !== 'function') {
        throw new Error(`Unknown API method: ${method}`);
      }

      // Special handling for openDialog with button handlers
      if (method === 'openDialog' && args.length >= 1) {
        // Special handling for dialog with button onClick handlers
        const dialogCfg = args[0];
        if (dialogCfg.buttons) {
          dialogCfg.buttons = dialogCfg.buttons.map(
            (button: Record<string, unknown>, index: number) => {
              if (button[HAS_DIALOG_BUTTON_HANDLER]) {
                const buttonCfg = { ...button };
                delete buttonCfg[HAS_DIALOG_BUTTON_HANDLER];
                // Replace function with a proxy that sends message back to iframe
                return {
                  ...buttonCfg,
                  onClick: async () => {
                    // Send message to iframe to execute the button handler
                    (event.source as Window)?.postMessage(
                      {
                        type: PluginIframeMessageType.DIALOG_BUTTON_CLICK,
                        buttonIndex: index,
                        dialogCallId: callId,
                      },
                      { targetOrigin: '*' },
                    );
                    // Wait for response
                    return new Promise((resolve, reject) => {
                      const handleResponse = (e: MessageEvent): void => {
                        if (
                          e.source === event.source &&
                          e.data?.bridgeToken === config.bridgeToken &&
                          e.data?.bridgeGeneration === config.bridgeGeneration &&
                          e.data?.type ===
                            PluginIframeMessageType.DIALOG_BUTTON_RESPONSE &&
                          e.data?.dialogCallId === callId &&
                          e.data?.buttonIndex === index
                        ) {
                          window.removeEventListener('message', handleResponse);
                          if (e.data.error) {
                            reject(new Error(e.data.error));
                          } else {
                            resolve(e.data.result);
                          }
                        }
                      };
                      window.addEventListener('message', handleResponse);
                    });
                  },
                };
              }
              return button;
            },
          );
        }
        const result = await bridge[method](dialogCfg);
        (event.source as Window)?.postMessage(
          {
            type: PluginIframeMessageType.API_RESPONSE,
            callId,
            result,
          },
          '*',
        );
      } else {
        // Normal method call
        const result = await bridge[method](...(args || []));
        (event.source as Window)?.postMessage(
          {
            type: PluginIframeMessageType.API_RESPONSE,
            callId,
            result,
          },
          '*',
        );
      }
    } catch (error) {
      (event.source as Window)?.postMessage(
        {
          type: PluginIframeMessageType.API_ERROR,
          callId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        '*',
      );
    }
  }

  // Handle plugin message forwarding
  if (data.type === PluginIframeMessageType.MESSAGE && data.messageId) {
    try {
      // Forward the message to the plugin using the bridge
      const result = await config.pluginBridge.sendMessageToPlugin(
        config.pluginId,
        data.message,
      );

      // Send the response back to the iframe
      (event.source as Window)?.postMessage(
        {
          type: PluginIframeMessageType.MESSAGE_RESPONSE,
          messageId: data.messageId,
          result,
        },
        '*',
      );
    } catch (error) {
      (event.source as Window)?.postMessage(
        {
          type: PluginIframeMessageType.MESSAGE_ERROR,
          messageId: data.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        '*',
      );
    }
  }

  // Handle plugin ready
  if (data.type === PluginIframeMessageType.READY && data.pluginId === config.pluginId) {
    PluginLog.log(`Plugin ${config.pluginId} is ready`);
  }
};

const isValidBridgeMessage = (
  data: Record<string, unknown>,
  config: PluginIframeConfig,
): boolean => {
  const hostHandledTypes = new Set<unknown>([
    PluginIframeMessageType.API_CALL,
    PluginIframeMessageType.MESSAGE,
    PluginIframeMessageType.READY,
  ]);
  if (!hostHandledTypes.has(data.type)) {
    return true;
  }
  if (data.type === PluginIframeMessageType.MESSAGE) {
    // Legacy iframe UIs post raw plugin-to-plugin messages. PluginIndexComponent
    // source-checks the mounted iframe and verifies the current bridge generation
    // before calling into this handler.
    return true;
  }
  return (
    data.bridgeToken === config.bridgeToken &&
    data.bridgeGeneration === config.bridgeGeneration
  );
};
