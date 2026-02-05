import { PluginBridgeService } from '../plugin-bridge.service';
import { PluginBaseCfg, PluginManifest } from '../plugin-api.model';
import { PluginIframeMessageType } from '@super-productivity/plugin-api';
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
  boundMethods?: ReturnType<typeof PluginBridgeService.prototype.createBoundMethods>;
}

// Simple sandbox - allow what plugins need
export const PLUGIN_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';

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

  return `
    <style id="injected-theme-vars">
      :root {
        --bg: ${getVar('--bg')};
        --bg-darker: ${getVar('--bg-darker')};
        --text-color: ${getVar('--text-color')};
        --text-color-less-intense: ${getVar('--text-color-less-intense')};
        --text-color-muted: ${getVar('--text-color-muted')};
        --card-bg: ${getVar('--card-bg')};
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
        const pendingCalls = new Map();
        const dialogButtonHandlers = new Map();
        const hookHandlers = new Map(); // Store hook handlers by hook type

        // Handle responses from parent
        window.addEventListener('message', function(event) {
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
              try {
                const result = handler();
                window.parent.postMessage({
                  type: '${PluginIframeMessageType.DIALOG_BUTTON_RESPONSE}',
                  dialogCallId: data.dialogCallId,
                  buttonIndex: data.buttonIndex,
                  result: result
                }, '*');
              } catch (error) {
                window.parent.postMessage({
                  type: '${PluginIframeMessageType.DIALOG_BUTTON_RESPONSE}',
                  dialogCallId: data.dialogCallId,
                  buttonIndex: data.buttonIndex,
                  error: error.message
                }, '*');
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
                    return buttonWithoutHandler;
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

        // Create the PluginAPI object with all methods
        window.PluginAPI = {
          cfg: ${JSON.stringify(config.baseCfg)},

          // Add Hooks enum
          Hooks: {
            TASK_COMPLETE: 'taskComplete',
            TASK_UPDATE: 'taskUpdate',
            TASK_DELETE: 'taskDelete',
            CURRENT_TASK_CHANGE: 'currentTaskChange',
            FINISH_DAY: 'finishDay',
            LANGUAGE_CHANGE: 'languageChange',
            PERSISTED_DATA_UPDATE: 'persistedDataUpdate',
            ACTION: 'action'
          },

          // Task methods
          getTasks: () => callApi('getTasks'),
          getArchivedTasks: () => callApi('getArchivedTasks'),
          getCurrentContextTasks: () => callApi('getCurrentContextTasks'),
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

          // Persistence methods
          persistDataSynced: (data) => callApi('persistDataSynced', [data]),
          loadPersistedData: () => callApi('loadPersistedData'),
          loadSyncedData: () => callApi('loadPersistedData'), // Alias

          // Registration methods
          registerHook: (hook, handler) => callApi('registerHook', [hook, handler]),
          registerHeaderButton: (cfg) => callApi('registerHeaderButton', [cfg]),
          registerMenuEntry: (cfg) => callApi('registerMenuEntry', [cfg]),
          registerShortcut: (cfg) => callApi('registerShortcut', [cfg]),
          registerSidePanelButton: (cfg) => callApi('registerSidePanelButton', [cfg]),

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

          // Message handling
          onMessage: (handler) => {
            // Store the handler and set up message listener
            window.__pluginMessageHandler = handler;
            window.addEventListener('message', async (event) => {
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

  // Ensure we have bound methods
  if (!config.boundMethods) {
    config.boundMethods = config.pluginBridge.createBoundMethods(
      config.pluginId,
      config.manifest,
    );
  }

  // Handle API calls
  if (data.type === PluginIframeMessageType.API_CALL && data.callId) {
    const { method, args, callId } = data;

    try {
      // For iframe plugins, we need to handle API calls differently
      // Some methods need special handling because the bridge methods have different signatures

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
            // Legacy string handler support
            const handler = new Function('return ' + handlerPlaceholder)();
            result = await bridge.registerHook(config.pluginId, hook, handler);
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
          // Create a mapping of button indices to their handlers
          const buttonHandlers = new Map();
          dialogCfg.buttons = dialogCfg.buttons.map(
            (button: Record<string, unknown>, index: number) => {
              if (button.onClick) {
                buttonHandlers.set(index, button.onClick);
                // Replace function with a proxy that sends message back to iframe
                return {
                  ...button,
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
                    return new Promise((resolve) => {
                      const handleResponse = (e: MessageEvent): void => {
                        if (
                          e.data?.type ===
                            PluginIframeMessageType.DIALOG_BUTTON_RESPONSE &&
                          e.data?.dialogCallId === callId &&
                          e.data?.buttonIndex === index
                        ) {
                          window.removeEventListener('message', handleResponse);
                          resolve(e.data.result);
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
