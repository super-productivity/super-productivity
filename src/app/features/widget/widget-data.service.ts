import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';
import { WidgetBridge } from './widget-bridge';
import { WIDGET_DATA_KEY, WidgetData } from './widget-data.model';
import { selectWidgetData } from './store/widget.selectors';
import { Log } from '../../core/log';
import { DateService } from '../../core/date/date.service';

export const getWidgetValidUntilMs = (
  nowMs: number,
  startOfNextDayDiffMs: number,
): number => {
  // This is the exact inverse of DateService's fixed-millisecond logical clock
  // (`new Date(timestamp - offset)`). Keep the same semantics across DST so the
  // widget expires when the app's Today classification changes.
  const logicalNow = new Date(nowMs - startOfNextDayDiffMs);
  logicalNow.setHours(24, 0, 0, 0);
  return logicalNow.getTime() + startOfNextDayDiffMs;
};

export const serializeWidgetData = (
  data: WidgetData,
  nowMs: number,
  startOfNextDayDiffMs: number,
): string =>
  JSON.stringify({
    ...data,
    validUntil: getWidgetValidUntilMs(nowMs, startOfNextDayDiffMs),
  });

export class WidgetPushQueue {
  private _pending: Promise<void> = Promise.resolve();

  enqueue(push: () => Promise<boolean>): Promise<boolean> {
    const result = this._pending.then(push);
    this._pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface WidgetDoneQueueLease {
  queueJson: string;
  /** iOS revision token; Android's legacy destructive read has no token. */
  acknowledgementToken?: string;
}

/**
 * Pushes the current today-task snapshot to the native store backing the home
 * screen widget (Android: KeyValStore via androidInterface; iOS: App Group
 * UserDefaults via the WidgetBridge Capacitor plugin). Dedupes against the
 * last successfully pushed blob so every trigger path (state change, pause,
 * post-sync) can call it unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class WidgetDataService {
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _lastPushedJson: string | null = null;
  private _pushQueue = new WidgetPushQueue();

  pushCurrent(): Promise<boolean> {
    return this._pushQueue.enqueue(() => this._pushCurrentNow());
  }

  private async _pushCurrentNow(): Promise<boolean> {
    try {
      // Read inside the serialized section so a later trigger always writes a
      // state at least as fresh as the push before it.
      const data = await firstValueFrom(this._store.select(selectWidgetData));
      const json = serializeWidgetData(
        data,
        Date.now(),
        this._dateService.getStartOfNextDayDiffMs(),
      );
      if (json === this._lastPushedJson) {
        return true;
      }
      if (IS_ANDROID_WEB_VIEW) {
        await androidInterface.saveToDbWrapped(WIDGET_DATA_KEY, json);
        androidInterface.updateWidget?.();
      } else {
        await WidgetBridge.setWidgetData({ json });
      }
      // only remember successful pushes, so a failed one is retried next trigger
      this._lastPushedJson = json;
      return true;
    } catch (e) {
      Log.err('Failed to push widget data', e);
      return false;
    }
  }

  /** Read pending iOS widget targets without deleting the native lease. */
  async readDoneQueue(): Promise<WidgetDoneQueueLease | null> {
    if (IS_ANDROID_WEB_VIEW) {
      throw new Error('Android widget queue reads must use the synchronous drain path');
    }
    const { json, token } = await WidgetBridge.readDoneQueue();
    if (!json) {
      return null;
    }
    if (!token) {
      throw new Error('iOS widget queue lease is missing its acknowledgement token');
    }
    return { queueJson: json, acknowledgementToken: token };
  }

  /**
   * Acknowledge an iOS queue lease after the matching task operations and
   * updated native snapshot are durable.
   */
  async acknowledgeDoneQueue(lease: WidgetDoneQueueLease): Promise<void> {
    if (IS_ANDROID_WEB_VIEW) {
      throw new Error('Android widget queues do not support acknowledgement');
    }
    if (!lease.acknowledgementToken) {
      throw new Error('Cannot acknowledge iOS widget queue without a lease token');
    }
    await WidgetBridge.acknowledgeDoneQueue({
      token: lease.acknowledgementToken,
    });
  }
}
