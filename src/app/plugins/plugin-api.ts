import {
  BatchUpdateRequest,
  BatchUpdateResult,
  DialogCfg,
  DialogResult,
  Hooks,
  IssueProviderPluginDefinition,
  NotifyCfg,
  OAuthFlowConfig,
  OAuthTokenResult,
  PluginAPI as PluginAPIInterface,
  PluginAppState,
  PluginBaseCfg,
  PluginCreateTaskData,
  PluginHeaderBtnCfg,
  PluginHookHandler,
  PluginHooks,
  PluginManifest,
  PluginMenuEntryCfg,
  PluginNodeScriptRequest,
  PluginNodeScriptResult,
  PluginRequestOptions,
  PluginShortcutCfg,
  PluginSidePanelBtnCfg,
  PluginWorkContextHeaderBtnCfg,
  ActiveWorkContext,
  Project,
  SnackCfg,
  Tag,
  Task,
} from '@super-productivity/plugin-api';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginLog } from '../core/log';
import { PluginI18nService } from './plugin-i18n.service';
import { formatDateForPlugin } from './plugin-i18n-date.util';
import {
  projectCopyToProjectData,
  projectDataToPartialProjectCopy,
  tagCopyToTagData,
  tagDataToPartialTagCopy,
  taskCopyToTaskData,
  taskDataToPartialTaskCopy,
} from './plugin-api-mapper';

/**
 * PluginAPI implementation that uses direct bridge service injection
 * This provides a clean intermediary layer between plugins and app services
 */
export class PluginAPI implements PluginAPIInterface {
  readonly Hooks = PluginHooks;
  #pluginId: string;
  #pluginBridge: PluginBridgeService;
  #pluginI18nService: PluginI18nService;
  #manifest?: PluginManifest;
  #onReadyRegister?: (fn: () => void | Promise<void>) => void;
  #onUnloadRegister?: (fn: () => void | Promise<void>) => void;
  #hookHandlers = new Map<string, Map<Hooks, Array<PluginHookHandler<Hooks>>>>();
  #messageHandler?: (message: unknown) => Promise<unknown>;
  #boundMethods: ReturnType<typeof PluginBridgeService.prototype.createBoundMethods>;

  /**
   * Logger instance for this plugin
   */
  readonly log: ReturnType<
    typeof PluginBridgeService.prototype.createBoundMethods
  >['log'];
  executeNodeScript?: (
    request: PluginNodeScriptRequest,
  ) => Promise<PluginNodeScriptResult>;

  constructor(
    public cfg: PluginBaseCfg,
    pluginId: string,
    pluginBridge: PluginBridgeService,
    pluginI18nService: PluginI18nService,
    manifest?: PluginManifest,
    lifecycleRegisters?: {
      onReady?: (fn: () => void | Promise<void>) => void;
      onUnload?: (fn: () => void | Promise<void>) => void;
    },
  ) {
    this.#pluginId = pluginId;
    this.#pluginBridge = pluginBridge;
    this.#pluginI18nService = pluginI18nService;
    this.#manifest = manifest;
    this.#onReadyRegister = lifecycleRegisters?.onReady;
    this.#onUnloadRegister = lifecycleRegisters?.onUnload;

    // Get bound methods for this plugin
    this.#boundMethods = this.#pluginBridge.createBoundMethods(
      this.#pluginId,
      this.#manifest,
    );

    // Set executeNodeScript if available
    if (this.#boundMethods.executeNodeScript) {
      this.executeNodeScript = this.#boundMethods.executeNodeScript;
    }

    // Set up logging for this plugin
    this.log = this.#boundMethods.log;
  }

  registerHook<T extends Hooks>(hook: T, fn: PluginHookHandler<T>): void {
    if (!this.#hookHandlers.has(this.#pluginId)) {
      this.#hookHandlers.set(this.#pluginId, new Map());
    }

    const pluginHooks = this.#hookHandlers.get(this.#pluginId)!;
    if (!pluginHooks.has(hook)) {
      pluginHooks.set(hook, []);
    }

    pluginHooks.get(hook)!.push(fn as PluginHookHandler<Hooks>);
    PluginLog.log(`Plugin ${this.#pluginId} registered hook: ${hook}`);

    // Register hook with bridge
    this.#pluginBridge.registerHook(this.#pluginId, hook, fn as PluginHookHandler<Hooks>);
  }

  registerHeaderButton(headerBtnCfg: PluginHeaderBtnCfg): void {
    PluginLog.log(`Plugin ${this.#pluginId} registered header button`);
    this.#boundMethods.registerHeaderButton(headerBtnCfg);
  }

  registerMenuEntry(menuEntryCfg: Omit<PluginMenuEntryCfg, 'pluginId'>): void {
    PluginLog.log(`Plugin ${this.#pluginId} registered menu entry`);
    this.#boundMethods.registerMenuEntry(menuEntryCfg);
  }

  registerConfigHandler(handler: () => void): void {
    PluginLog.log(`Plugin ${this.#pluginId} registered config handler`);
    this.#boundMethods.registerConfigHandler(handler);
  }

  registerShortcut(
    shortcutCfg: Omit<PluginShortcutCfg, 'pluginId'> & { id?: string },
  ): void {
    // Generate ID if not provided - use sanitized label as fallback
    const id =
      shortcutCfg.id || shortcutCfg.label.toLowerCase().replace(/[^a-z0-9-_]/g, '_');

    const shortcut: PluginShortcutCfg = {
      ...shortcutCfg,
      id,
      pluginId: this.#pluginId,
    };

    PluginLog.log(`Plugin ${this.#pluginId} registered shortcut`);

    // Register shortcut with bridge
    this.#boundMethods.registerShortcut(shortcut);
  }

  registerSidePanelButton(
    sidePanelBtnCfg: Omit<PluginSidePanelBtnCfg, 'pluginId'>,
  ): void {
    PluginLog.log(`Plugin ${this.#pluginId} registered side panel button`);
    this.#boundMethods.registerSidePanelButton(sidePanelBtnCfg);
  }

  registerWorkContextHeaderButton(
    cfg: Omit<PluginWorkContextHeaderBtnCfg, 'pluginId'>,
  ): void {
    PluginLog.log(`Plugin ${this.#pluginId} registered work-context header button`, cfg);
    this.#boundMethods.registerWorkContextHeaderButton(cfg);
  }

  registerIssueProvider(definition: IssueProviderPluginDefinition): void {
    PluginLog.log(`Plugin ${this.#pluginId} registering issue provider`);
    this.#boundMethods.registerIssueProvider(definition);
  }

  showIndexHtmlAsView(): void {
    PluginLog.log(`Plugin ${this.#pluginId} requested to show index.html`);
    return this.#boundMethods.showIndexHtmlAsView();
  }

  showInWorkContext(): void {
    PluginLog.log(`Plugin ${this.#pluginId} requested work-context embed`);
    this.#boundMethods.showInWorkContext();
  }

  closeWorkContextView(): void {
    PluginLog.log(`Plugin ${this.#pluginId} closed work-context embed`);
    this.#boundMethods.closeWorkContextView();
  }

  async getActiveWorkContext(): Promise<ActiveWorkContext | null> {
    return this.#boundMethods.getActiveWorkContext();
  }

  async getTasks(): Promise<Task[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested all tasks`);
    const tasks = await this.#pluginBridge.getTasks();
    return tasks.map(taskCopyToTaskData);
  }

  async getArchivedTasks(): Promise<Task[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested archived tasks`);
    const tasks = await this.#pluginBridge.getArchivedTasks();
    return tasks.map(taskCopyToTaskData);
  }

  async getCurrentContextTasks(): Promise<Task[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested current context tasks`);
    const tasks = await this.#pluginBridge.getCurrentContextTasks();
    return tasks.map(taskCopyToTaskData);
  }

  async getSelectedTask(): Promise<Task | null> {
    PluginLog.log(`Plugin ${this.#pluginId} requested selected task`);
    const task = await this.#boundMethods.getSelectedTask();
    return task ? taskCopyToTaskData(task) : null;
  }

  async getFocusedTask(): Promise<Task | null> {
    PluginLog.log(`Plugin ${this.#pluginId} requested focused task`);
    const task = await this.#boundMethods.getFocusedTask();
    return task ? taskCopyToTaskData(task) : null;
  }

  async getAppState(): Promise<PluginAppState> {
    PluginLog.log(`Plugin ${this.#pluginId} requested app state snapshot`);
    return this.#pluginBridge.getAppState();
  }

  async reInitData(): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested data re-init`);
    return this.#pluginBridge.reInitData();
  }
  async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to update task ${taskId}`);
    const taskCopyUpdates = taskDataToPartialTaskCopy(updates);
    return this.#pluginBridge.updateTask(taskId, taskCopyUpdates);
  }

  async addTask(taskData: PluginCreateTaskData): Promise<string> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to add task`);
    return this.#pluginBridge.addTask(taskData);
  }

  async deleteTask(taskId: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to delete task ${taskId}`);
    return this.#pluginBridge.deleteTask(taskId);
  }

  async getAllProjects(): Promise<Project[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested all projects`);
    const projects = await this.#pluginBridge.getAllProjects();
    return projects.map(projectCopyToProjectData);
  }

  async addProject(projectData: Partial<Project>): Promise<string> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to add project`);
    const projectCopyData = projectDataToPartialProjectCopy(projectData);
    return this.#pluginBridge.addProject(projectCopyData);
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to update project ${projectId}`);
    const projectCopyUpdates = projectDataToPartialProjectCopy(updates);
    return this.#pluginBridge.updateProject(projectId, projectCopyUpdates);
  }

  async getAllTags(): Promise<Tag[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested all tags`);
    const tags = await this.#pluginBridge.getAllTags();
    return tags.map(tagCopyToTagData);
  }

  async addTag(tagData: Partial<Tag>): Promise<string> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to add tag`);
    const tagCopyData = tagDataToPartialTagCopy(tagData);
    return this.#pluginBridge.addTag(tagCopyData);
  }

  async updateTag(tagId: string, updates: Partial<Tag>): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to update tag ${tagId}`);
    const tagCopyUpdates = tagDataToPartialTagCopy(updates);
    return this.#pluginBridge.updateTag(tagId, tagCopyUpdates);
  }

  async reorderTasks(
    taskIds: string[],
    contextId: string,
    contextType: 'project' | 'task',
  ): Promise<void> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to reorder tasks in ${contextType} ${contextId}:`,
      taskIds,
    );
    return this.#pluginBridge.reorderTasks(taskIds, contextId, contextType);
  }

  async selectTask(taskId: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to select task ${taskId}`);
    return this.#pluginBridge.selectTask(taskId);
  }

  async batchUpdateForProject(request: BatchUpdateRequest): Promise<BatchUpdateResult> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested batch update for project ${(request as { projectId: string }).projectId}`,
    );
    return this.#pluginBridge.batchUpdateForProject(request);
  }

  showSnack(snackCfg: SnackCfg): void {
    this.#pluginBridge.showSnack(snackCfg);
  }

  async notify(notifyCfg: NotifyCfg): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested notification`);
    return this.#pluginBridge.notify(notifyCfg);
  }

  persistDataSynced(dataStr: string, key?: string): Promise<void> {
    // Log keyLen, not key — plugins may use user-supplied content as keys
    // (search queries, document titles), and the log history is exportable.
    // CLAUDE.md rule 9: only ids, never user content.
    PluginLog.log(`Plugin ${this.#pluginId} requested to persist data`, {
      keyLen: key?.length ?? 0,
    });
    return this.#boundMethods.persistDataSynced(dataStr, key);
  }

  loadSyncedData(key?: string): Promise<string | null> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to load persisted data`, {
      keyLen: key?.length ?? 0,
    });
    return this.#boundMethods.loadPersistedData(key);
  }

  async getConfig(): Promise<any> {
    PluginLog.log(`Plugin ${this.#pluginId} requested configuration`);
    return this.#boundMethods.getConfig();
  }

  async downloadFile(filename: string, data: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to download file "${filename}"`);
    return this.#boundMethods.downloadFile(filename, data);
  }

  async openDialog(dialogCfg: DialogCfg): Promise<DialogResult> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to open dialog`);
    return this.#pluginBridge.openDialog(dialogCfg);
  }

  async triggerSync(): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to trigger sync`);
    return this.#boundMethods.triggerSync();
  }

  /**
   * Register a callback to run after the app confirms all declared APIs are ready.
   * Put startup init code here (e.g. executeNodeScript calls) instead of at the
   * top level of plugin.js. For nodeExecution plugins, fires only after a successful
   * IPC ping — guaranteeing the bridge is available.
   */
  onReady(fn: () => void | Promise<void>): void {
    this.#onReadyRegister?.(fn);
  }

  /**
   * Register a callback the host invokes when the plugin is disabled, reloaded,
   * or uninstalled. Code-based plugins must clear timers/listeners they created
   * here, since they run directly in the renderer and outlive their unload
   * otherwise. The returned promise is not awaited — do synchronous cleanup
   * before any await. Registering again replaces the previous callback.
   */
  onUnload(fn: () => void | Promise<void>): void {
    this.#onUnloadRegister?.(fn);
  }

  /**
   * Register a message handler for the plugin
   * This allows the plugin's iframe to communicate with the plugin code
   */
  onMessage(handler: (message: unknown) => Promise<unknown>): void {
    this.#messageHandler = handler;
    PluginLog.log(`Plugin ${this.#pluginId} registered message handler`);
  }

  /**
   * Send a message to the plugin's message handler
   * Used internally by the plugin system
   */
  async __sendMessage(message: unknown): Promise<unknown> {
    if (!this.#messageHandler) {
      throw new Error(`Plugin ${this.#pluginId} has no message handler registered`);
    }

    return await this.#messageHandler(message);
  }

  // Internal methods for the plugin system
  __getHookHandlers(): Map<string, Map<Hooks, Array<PluginHookHandler>>> {
    return this.#hookHandlers;
  }

  /**
   * Execute an NgRx action if it's in the allowed list
   */
  dispatchAction(action: { type: string; [key: string]: unknown }): void {
    // Log the action TYPE only — the full action carries user content
    // and the log history is user-exportable. See core/log.ts header / rule #9.
    PluginLog.log(`Plugin ${this.#pluginId} requested to execute action: ${action.type}`);
    return this.#boundMethods.dispatchAction(action);
  }

  /**
   * Check if the application window is currently focused
   */
  isWindowFocused(): boolean {
    return this.#pluginBridge.isWindowFocused();
  }

  /**
   * Register a handler for window focus changes
   */
  onWindowFocusChange(handler: (isFocused: boolean) => void): void {
    this.#pluginBridge.onWindowFocusChange(this.#pluginId, handler);
  }

  /**
   * Gets all simple counters as { [key: string]: number }.
   */
  async getAllCounters(): Promise<{ [key: string]: number }> {
    PluginLog.log(`Plugin ${this.#pluginId} requested all simple counters`);
    return this.#pluginBridge.getAllCounters();
  }

  /**
   * Gets a single simple counter value (undefined if unset).
   * @param id The counter id (e.g., 'daily-commits').
   */
  async getCounter(id: string): Promise<number | null> {
    PluginLog.log(`Plugin ${this.#pluginId} requested counter value for id: ${id}`);
    const value = await this.#pluginBridge.getCounter(id);
    return value ?? null;
  }

  /**
   * Sets a simple counter value.
   * @param id The counter id.
   * @param value The numeric value.
   */
  async setCounter(id: string, value: number): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to set counter ${id} to ${value}`);
    return this.#pluginBridge.setCounter(id, value);
  }

  /**
   * Increments a simple counter (default +1).
   * @param id The counter id.
   * @param incrementBy Increment amount (default: 1).
   */
  async incrementCounter(id: string, incrementBy = 1): Promise<number> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to increment counter ${id} by ${incrementBy}`,
    );
    const newValue = await this.#pluginBridge.incrementCounter(id, incrementBy);
    return newValue;
  }

  /**
   * Decrements a simple counter (floors at 0, default -1).
   * @param id The counter id.
   * @param decrementBy Decrement amount (default: 1).
   */
  async decrementCounter(id: string, decrementBy = 1): Promise<number> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to decrement counter ${id} by ${decrementBy}`,
    );
    const newValue = await this.#pluginBridge.decrementCounter(id, decrementBy);
    return newValue;
  }

  /**
   * Deletes a simple counter.
   * @param id The counter ID.
   */
  async deleteCounter(id: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to delete counter ${id}`);
    return this.#pluginBridge.deleteSimpleCounter(id);
  }

  /**
   * Gets all simple counters as SimpleCounter[].
   */
  async getAllSimpleCounters(): Promise<any[]> {
    PluginLog.log(`Plugin ${this.#pluginId} requested all simple counters (full model)`);
    return this.#pluginBridge.getAllSimpleCounters();
  }

  /**
   * Gets a single simple counter by ID.
   * @param id The counter ID.
   */
  async getSimpleCounter(id: string): Promise<any | undefined> {
    PluginLog.log(`Plugin ${this.#pluginId} requested simple counter ${id}`);
    return this.#pluginBridge.getSimpleCounter(id);
  }

  /**
   * Updates a simple counter (partial).
   * @param id The counter ID.
   * @param updates Partial updates.
   */
  async updateSimpleCounter(id: string, updates: Partial<any>): Promise<void> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to update simple counter ${id}`,
      updates,
    );
    return this.#pluginBridge.updateSimpleCounter(id, updates);
  }

  /**
   * Toggles a simple counter's isOn state.
   * @param id The counter ID.
   */
  async toggleSimpleCounter(id: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to toggle simple counter ${id}`);
    return this.#pluginBridge.toggleSimpleCounter(id);
  }

  /**
   * Sets a simple counter's isEnabled state.
   * @param id The counter ID.
   * @param isEnabled Enabled state.
   */
  async setSimpleCounterEnabled(id: string, isEnabled: boolean): Promise<void> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to set simple counter ${id} enabled: ${isEnabled}`,
    );
    return this.#pluginBridge.setSimpleCounterEnabled(id, isEnabled);
  }

  /**
   * Deletes a simple counter.
   * @param id The counter ID.
   */
  async deleteSimpleCounter(id: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested to delete simple counter ${id}`);
    return this.#pluginBridge.deleteSimpleCounter(id);
  }

  /**
   * Sets a simple counter value for today.
   * @param id The counter ID.
   * @param value The numeric value.
   */
  async setSimpleCounterToday(id: string, value: number): Promise<void> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to set simple counter ${id} today to ${value}`,
    );
    return this.#pluginBridge.setSimpleCounterToday(id, value);
  }

  /**
   * Sets a simple counter value for a specific date.
   * @param id The counter ID.
   * @param date The date (`YYYY-MM-DD`).
   * @param value The numeric value.
   */
  async setSimpleCounterDate(id: string, date: string, value: number): Promise<void> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested to set simple counter ${id} on ${date} to ${value}`,
    );
    return this.#pluginBridge.setSimpleCounterDate(id, date, value);
  }

  /**
   * Translate a key using plugin's translation files
   * Falls back to English, then to the key itself if not found
   */
  translate(key: string, params?: Record<string, string | number>): string {
    return this.#pluginI18nService.translate(this.#pluginId, key, params);
  }

  /**
   * Format a date according to predefined format and current locale
   * Supports: 'short', 'medium', 'long', 'time', 'datetime'
   */
  formatDate(
    date: Date | string | number,
    format: 'short' | 'medium' | 'long' | 'time' | 'datetime',
  ): string {
    const locale = this.#pluginI18nService.getCurrentLanguage();
    return formatDateForPlugin(date, format, locale);
  }

  /**
   * Get the current app language code
   */
  getCurrentLanguage(): string {
    return this.#pluginI18nService.getCurrentLanguage();
  }

  async startOAuthFlow(config: OAuthFlowConfig): Promise<OAuthTokenResult> {
    PluginLog.log(`Plugin ${this.#pluginId} requested OAuth flow`);
    return this.#boundMethods.startOAuthFlow(config);
  }

  async getOAuthToken(): Promise<string | null> {
    return this.#boundMethods.getOAuthToken();
  }

  async clearOAuthToken(): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested OAuth token clear`);
    return this.#boundMethods.clearOAuthToken();
  }

  async setSecret(key: string, value: string): Promise<void> {
    return this.#boundMethods.setSecret(key, value);
  }

  async getSecret(key: string): Promise<string | null> {
    return this.#boundMethods.getSecret(key);
  }

  async deleteSecret(key: string): Promise<void> {
    PluginLog.log(`Plugin ${this.#pluginId} requested secret delete`);
    return this.#boundMethods.deleteSecret(key);
  }

  async request<T = unknown>(url: string, options?: PluginRequestOptions): Promise<T> {
    PluginLog.log(
      `Plugin ${this.#pluginId} requested host HTTP ${options?.method ?? 'GET'}`,
    );
    return this.#boundMethods.request<T>(url, options);
  }

  /**
   * Clean up all resources associated with this plugin API instance
   * Called when the plugin is being unloaded
   */
  cleanup(): void {
    PluginLog.log(`Cleaning up PluginAPI for plugin ${this.#pluginId}`);

    // Clear all hook handlers
    this.#hookHandlers.clear();

    // Unregister issue provider if one was registered
    this.#boundMethods.unregisterIssueProvider();

    // Notify bridge service to clean up its registrations
    // This is handled by the plugin runner calling unregisterPluginHooks
  }
}
