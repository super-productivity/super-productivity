import { inject, Injectable, Injector, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import type {
  PluginAPI,
  PluginTaskDetailBlockCfg,
  TaskHistoryPage,
  TaskHistoryQuery,
} from '@super-productivity/plugin-api';
import { selectTaskFeatureState } from '../features/tasks/store/task.selectors';
import { OperationWriteFlushService } from '../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../op-log/capture/operation-capture.service';
import { getDeferredActions } from '../op-log/capture/operation-capture.meta-reducer';

export interface RegisteredTaskDetailBlock extends PluginTaskDetailBlockCfg {
  pluginId: string;
}

@Injectable({ providedIn: 'root' })
export class PluginTaskHistoryService {
  private readonly _injector = inject(Injector);
  private readonly _blocks = signal<RegisteredTaskDetailBlock[]>([]);
  readonly blocks = this._blocks.asReadonly();

  bind(pluginId: string): Pick<PluginAPI, 'registerTaskDetailBlock' | 'getTaskHistory'> {
    return {
      registerTaskDetailBlock: (cfg) => this.register(pluginId, cfg),
      getTaskHistory: (taskId, options) => this.read(taskId, options),
    };
  }

  register(pluginId: string, cfg: PluginTaskDetailBlockCfg): void {
    if (
      !cfg ||
      typeof cfg.id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cfg.id) ||
      typeof cfg.label !== 'string' ||
      !cfg.label.trim() ||
      cfg.label.length > 80
    ) {
      throw new Error('Task detail block requires an ID and a label (1..80 characters)');
    }
    const block = { pluginId, id: cfg.id, label: cfg.label.trim() };
    const existing = this._blocks();
    const index = existing.findIndex(
      (item) => item.pluginId === pluginId && item.id === cfg.id,
    );
    this._blocks.set(
      index < 0
        ? [...existing, block]
        : existing.map((item, i) => (i === index ? block : item)),
    );
  }

  unregister(pluginId: string): void {
    this._blocks.update((blocks) =>
      blocks.filter((block) => block.pluginId !== pluginId),
    );
  }

  async read(taskId: string, options: TaskHistoryQuery = {}): Promise<TaskHistoryPage> {
    if (typeof taskId !== 'string' || !taskId)
      throw new Error('A full task ID is required');
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new Error('Invalid task history options');
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error('History page limit must be 1..200');
    let cursor: { taskId: string; eventId: string } | undefined;
    if (options.cursor !== undefined) {
      try {
        const value: unknown = JSON.parse(decodeURIComponent(atob(options.cursor)));
        if (!value || typeof value !== 'object') throw new Error();
        const parsed = value as Record<string, unknown>;
        if (parsed['taskId'] !== taskId || typeof parsed['eventId'] !== 'string')
          throw new Error();
        cursor = { taskId, eventId: parsed['eventId'] };
      } catch {
        throw new Error('Invalid history cursor for this task');
      }
    }
    const capture = this._injector.get(OperationCaptureService);
    if (capture.hasUnrecoveredPersistFailure())
      throw new Error('History storage failed; reload the application');
    if (getDeferredActions().length)
      throw new Error('History is waiting for synchronization to finish');
    return this._injector
      .get(OperationWriteFlushService)
      .flushThenRunExclusive(async () => {
        if (capture.hasUnrecoveredPersistFailure())
          throw new Error('History storage failed; reload the application');
        if (getDeferredActions().length)
          throw new Error('History is waiting for synchronization to finish');
        const state = await firstValueFrom(
          this._injector.get(Store).select(selectTaskFeatureState),
        );
        const record = Object.hasOwn(state.taskHistory ?? {}, taskId)
          ? state.taskHistory![taskId]
          : undefined;
        const createdAt =
          state.entities[taskId]?.created ?? record?.baseline?.createdAt ?? null;
        const events = Object.values(record?.events ?? {}).sort(
          (a, b) =>
            b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        );
        const cursorId = cursor?.eventId;
        const start = cursorId
          ? events.findIndex((event) => event.id === cursorId) + 1
          : 0;
        if (cursor && start === 0)
          throw new Error('History changed; refresh before loading more');
        const page = events.slice(start, start + limit);
        const last = page.at(-1);
        const gaps = Object.values(record?.gaps ?? {}).sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        return structuredClone({
          taskId,
          createdAt,
          recordingStartedAt: record?.baseline?.observedAt ?? null,
          events: page,
          gaps,
          total: events.length,
          revision: `${record?.baseline?.id ?? ''}:${events.length}:${gaps.length}:${createdAt}`,
          nextCursor:
            last && start + page.length < events.length
              ? btoa(encodeURIComponent(JSON.stringify({ taskId, eventId: last.id })))
              : null,
        });
      });
  }
}
