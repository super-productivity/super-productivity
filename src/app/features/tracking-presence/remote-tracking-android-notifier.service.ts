import {
  EffectRef,
  Injectable,
  Injector,
  OnDestroy,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { merge, Subscription } from 'rxjs';
import { startWith } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';
import { TrackingPresenceService } from './tracking-presence.service';
import { TrackingPresenceState } from './tracking-presence.model';
import { selectTaskEntities } from '../tasks/store/task.selectors';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { T } from '../../t.const';

/**
 * Re-posting an unchanged notification within this window is skipped; at or
 * beyond it we re-post anyway so the native side's self-destruct timeout
 * (which a killed WebView would otherwise leave dangling) stays re-armed.
 */
const MIN_REPOST_MS = 60_000;

/**
 * A queued Stop tap older than this is dropped instead of applied: it matches
 * the native notification's self-destruct timeout, after which the session the
 * user saw may long be over (or replaced by one they never saw).
 */
export const REMOTE_STOP_TTL_MS = 150_000;

/** What to do with a queued Stop tap made at `stopAt`, given the remote state now. */
export const resolvePendingRemoteStop = (
  stopAt: number,
  now: number,
  remoteState: TrackingPresenceState | undefined,
): 'apply' | 'drop' | 'wait' => {
  if (now - stopAt > REMOTE_STOP_TTL_MS) {
    return 'drop';
  }
  // Unknown (WS not connected yet): wait. Already stopped: the tap is done —
  // keeping it would stop a session started there within the TTL.
  if (remoteState === undefined) {
    return 'wait';
  }
  return remoteState === 'tracking' ? 'apply' : 'drop';
};

/**
 * Drives the native Android notification mirroring another device's tracking
 * session. Thin renderer over TrackingPresenceService.remoteSessionView —
 * the staleness/label/Stop rules live there, shared with the header chip.
 * The view is null while THIS device tracks (the local foreground-service
 * notification wins — two contradicting ongoing icons is clutter). The
 * native side self-destructs the notification when updates stop, so a
 * killed WebView cannot leave a frozen "Tracking…" behind.
 */
@Injectable({
  providedIn: 'root',
})
export class RemoteTrackingAndroidNotifierService implements OnDestroy {
  private _presenceService = inject(TrackingPresenceService);
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _injector = inject(Injector);

  private _taskEntities = this._store.selectSignal(selectTaskEntities);
  private _isStarted = false;
  private _isNotificationShown = false;
  /** Last content handed to the native side, to skip redundant binder calls. */
  private _lastPosted: { text: string; showStop: boolean; at: number } | null = null;

  private _effectRef: EffectRef | null = null;
  private _stopEffectRef: EffectRef | null = null;
  private _stopSub: Subscription | null = null;
  private _stopQueueSub: Subscription | null = null;
  /** Epoch ms of a Stop tap waiting for the remote session to be known. */
  private _pendingStopAt = signal<number | null>(null);

  start(): void {
    if (!IS_ANDROID_WEB_VIEW || this._isStarted) {
      return;
    }
    this._isStarted = true;
    this._effectRef = effect(() => this._update(), { injector: this._injector });
    // Push path of APKs predating the persisted Stop queue (#10683).
    this._stopSub = androidInterface.onRemoteTrackingStop$.subscribe(() =>
      this._presenceService.requestRemoteStop(),
    );
    // The Stop tap opens the activity; on a cold start the WebView isn't ready
    // for a push, so native persists it and we pull it once we're running.
    this._stopQueueSub = merge(
      androidInterface.onResume$,
      androidInterface.onNotificationActionDrainRequest$,
    )
      .pipe(startWith(undefined))
      .subscribe(() => this._pullPendingStop());
    this._stopEffectRef = effect(() => this._applyPendingStop(), {
      injector: this._injector,
    });
  }

  stop(): void {
    if (!this._isStarted) {
      return;
    }
    this._isStarted = false;
    this._effectRef?.destroy();
    this._effectRef = null;
    this._stopSub?.unsubscribe();
    this._stopSub = null;
    this._stopQueueSub?.unsubscribe();
    this._stopQueueSub = null;
    this._stopEffectRef?.destroy();
    this._stopEffectRef = null;
    this._pendingStopAt.set(null);
    this._cancel();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private _pullPendingStop(): void {
    const raw = androidInterface.getRemoteTrackingStopQueue?.();
    const at = raw ? Number(raw) : NaN;
    if (Number.isFinite(at)) {
      this._pendingStopAt.set(at);
    }
  }

  /** Applies a queued Stop as soon as the remote session is known (WS connect). */
  private _applyPendingStop(): void {
    const at = this._pendingStopAt();
    if (at === null) {
      return;
    }
    const decision = resolvePendingRemoteStop(
      at,
      Date.now(),
      this._presenceService.remoteSession()?.payload.state,
    );
    if (decision === 'wait') {
      return;
    }
    this._pendingStopAt.set(null);
    if (decision === 'apply') {
      untracked(() => this._presenceService.requestRemoteStop());
    }
  }

  private _update(): void {
    if (!this._isStarted) {
      return;
    }
    const view = this._presenceService.remoteSessionView();
    if (!view) {
      this._cancel();
      return;
    }

    const p = view.session.payload;
    const t = (key: string, params?: Record<string, string | number>): string =>
      this._translateService.instant(key, params);

    const title =
      (p.taskId && this._taskEntities()?.[p.taskId]?.title) ||
      t(T.F.TRACKING_PRESENCE.CHIP.FALLBACK_TASK);
    const stateLabel = t(view.stateKey, { device: p.deviceLabel });
    const timeLabel = t(view.timeKey, {
      time: this._dateTimeFormatService.formatTime(view.timeTs),
    });
    const text = `${title} ${stateLabel} · ${timeLabel}`;

    const now = Date.now();
    if (
      this._lastPosted &&
      this._lastPosted.text === text &&
      this._lastPosted.showStop === view.showStop &&
      now - this._lastPosted.at < MIN_REPOST_MS
    ) {
      return;
    }
    this._lastPosted = { text, showStop: view.showStop, at: now };
    androidInterface.updateRemoteTrackingNotification?.(
      title,
      `${stateLabel} · ${timeLabel}`,
      view.showStop,
    );
    this._isNotificationShown = true;
  }

  private _cancel(): void {
    this._lastPosted = null;
    if (this._isNotificationShown) {
      androidInterface.cancelRemoteTrackingNotification?.();
      this._isNotificationShown = false;
    }
  }
}
