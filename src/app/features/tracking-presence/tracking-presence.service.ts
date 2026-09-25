import {
  EffectRef,
  Injectable,
  Injector,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription, combineLatest } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { selectCurrentTaskId } from '../tasks/store/task.selectors';
import { setCurrentTask } from '../tasks/store/task.actions';
import { selectIsIdle } from '../idle/store/idle.selectors';
import {
  selectCurrentCycle,
  selectIsSessionRunning,
} from '../focus-mode/store/focus-mode.selectors';
import {
  SuperSyncWebSocketService,
  PresenceWsMessage,
} from '../../op-log/sync/super-sync-websocket.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { OperationEncryptionService } from '../../op-log/sync/operation-encryption.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { SyncLog } from '../../core/log';
import {
  getDeviceLabel,
  resolveDeviceLabel,
  sanitizeDeviceLabel,
} from './get-device-label.util';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_HIDE_STALE_AFTER_MS,
  PRESENCE_STALE_AFTER_MS,
  PRESENCE_STOPPED_LINGER_MS,
  RemoteSessionView,
  RemoteTrackingSession,
  TrackingPresenceCmd,
  TrackingPresenceEnvelope,
  TrackingPresencePayload,
  TrackingPresenceState,
} from './tracking-presence.model';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';

/** Staleness re-check cadence for viewers; display is minute-granular. */
const VIEW_TICK_MS = 30_000;

interface LocalDerivedState {
  taskId: string | null;
  isIdle: boolean;
  isFocusRunning: boolean;
  focusCycle: number;
}

interface LocalSession {
  state: TrackingPresenceState;
  taskId: string | null;
  reason?: 'idle';
}

/** Producer-built frames; `deviceLabel` is resolved once per send in `_doSend`. */
type OutboundPayload = Omit<TrackingPresencePayload, 'deviceLabel'>;
type OutboundCmd = Omit<TrackingPresenceCmd, 'deviceLabel'>;

/**
 * Cross-device tracking presence over the SuperSync WebSocket.
 *
 * Producer side: derives this device's tracking-session state from the store
 * (current task + idle + focus) and broadcasts TRANSITIONS as ephemeral,
 * opaque (optionally E2E-encrypted) messages — never raw actions, never the
 * op-log. Viewer side: renders the last remote state as `remoteSession` and
 * can request a CAS-guarded remote stop.
 *
 * Deliberate invariants:
 * - `stopped` is only broadcast when THIS device was the one tracking —
 *   otherwise a device merely opening the app would clobber the single-slot
 *   server cache and clear every viewer.
 * - A takeover stop (another device started tracking) suppresses its own
 *   `stopped` broadcast for the same reason; a remote-commanded stop does NOT
 *   (that broadcast is the ack that clears the commanding viewer).
 * - All dispatched actions (`setCurrentTask`) are non-persistent, so nothing
 *   here can create sync ops or replay hazards.
 */
@Injectable({
  providedIn: 'root',
})
export class TrackingPresenceService implements OnDestroy {
  private _store = inject(Store);
  private _injector = inject(Injector);
  private _ws = inject(SuperSyncWebSocketService);
  private _providerManager = inject(SyncProviderManager);
  private _encryption = inject(OperationEncryptionService);
  private _snackService = inject(SnackService);

  /** Last known remote tracking session, or null when there is none to show. */
  readonly remoteSession = signal<RemoteTrackingSession | null>(null);

  /** Feeds view suppression while WE track. */
  private _localTaskIdView = this._store.selectSignal(selectCurrentTaskId);
  /** Ticks (only while a session is shown) so staleness re-evaluates. */
  private _viewNow = signal(Date.now());

  /**
   * The single view-model every viewer surface (header pill, Android
   * notification) renders from — null while THIS device tracks (the local
   * surface wins) or when there is nothing to show. Centralized so the
   * staleness rules ("past tense + no Stop when stale") cannot diverge
   * between surfaces.
   */
  readonly remoteSessionView = computed<RemoteSessionView | null>(() => {
    const session = this.remoteSession();
    if (!session || this._localTaskIdView()) {
      return null;
    }
    const isStale =
      !session.producerConnected ||
      this._viewNow() - session.receivedAt > PRESENCE_STALE_AFTER_MS;
    const p = session.payload;
    const stateKey = isStale
      ? T.F.TRACKING_PRESENCE.CHIP.WAS_TRACKING_ON
      : p.state === 'tracking'
        ? T.F.TRACKING_PRESENCE.CHIP.TRACKING_ON
        : p.reason === 'idle'
          ? T.F.TRACKING_PRESENCE.CHIP.PAUSED_ON
          : T.F.TRACKING_PRESENCE.CHIP.STOPPED_ON;
    return {
      session,
      isStale,
      stateKey,
      timeKey: isStale
        ? T.F.TRACKING_PRESENCE.CHIP.LAST_SEEN
        : T.F.TRACKING_PRESENCE.CHIP.SINCE,
      timeTs: isStale ? session.receivedAt : p.sinceTs,
      // Stop against a disconnected producer would be a promise the system
      // cannot keep — the button goes away rather than silently doing nothing.
      showStop: p.state === 'tracking' && !isStale,
    };
  });

  /**
   * Boolean gate for the hot-path main header: `remoteSessionView` mints a
   * fresh object on every staleness tick, this flips only when visibility
   * actually changes — so the header isn't re-dirtied twice a minute.
   */
  readonly isRemoteSessionShown = computed(() => this.remoteSessionView() !== null);

  private _subs: Subscription | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;
  private _viewTicker: ReturnType<typeof setInterval> | null = null;

  // Producer-session state
  private _current: LocalSession = { state: 'stopped', taskId: null };
  private _sessionId: string = '';
  private _seq = 0;
  private _sinceTs = 0;
  private _lastTrackedTaskId: string | null = null;
  private _focusCycle: number | undefined;
  private _suppressNextStopBroadcast = false;

  // Viewer ordering state
  private _lastOrdinal = 0;

  // Reconnect handling
  private _connEffect: EffectRef | null = null;
  private _wasConnected = false;
  /** A state broadcast was dropped while offline and must go out on reconnect. */
  private _pendingResend = false;

  start(): void {
    if (this._subs) {
      return;
    }
    // A previous run's producer session is dead: its final `stopped` frame has
    // gone out and its socket is gone. Reset so `_sessionId` really means
    // "tracked in THIS run" (what `_broadcastState`'s guard assumes) and no
    // frame can ever go out under the dead session's id/seq.
    this._sessionId = '';
    this._seq = 0;
    this._sinceTs = 0;
    this._subs = new Subscription();

    this._connEffect = effect(
      () => {
        const isConnected = this._ws.isConnected();
        if (isConnected && !this._wasConnected) {
          // Fresh connection: the server's ordinal chain restarts whenever the
          // user's last socket drops (not just on server restart) — never let
          // yesterday's high-water mark silently drop today's states.
          this._lastOrdinal = 0;
          if (this._pendingResend) {
            this._pendingResend = false;
            // Announce the transition that was dropped while offline — else a
            // stop made offline leaves a phantom session in the server cache.
            this._broadcastState();
          }
        }
        this._wasConnected = isConnected;
      },
      { injector: this._injector },
    );

    this._subs.add(
      combineLatest([
        this._store.select(selectCurrentTaskId),
        this._store.select(selectIsIdle),
        this._store.select(selectIsSessionRunning),
        this._store.select(selectCurrentCycle),
      ])
        .pipe(
          map(
            ([taskId, isIdle, isFocusRunning, focusCycle]): LocalDerivedState => ({
              taskId,
              isIdle,
              isFocusRunning,
              focusCycle,
            }),
          ),
          distinctUntilChanged(
            (a, b) =>
              a.taskId === b.taskId &&
              a.isIdle === b.isIdle &&
              a.isFocusRunning === b.isFocusRunning &&
              a.focusCycle === b.focusCycle,
          ),
        )
        .subscribe((derived) => this._onLocalChange(derived)),
    );

    this._subs.add(
      this._ws.presenceMessage$.subscribe((msg) => {
        this._onPresenceMessage(msg).catch((err) =>
          SyncLog.warn('TrackingPresenceService: Failed to handle presence message', err),
        );
      }),
    );
  }

  /**
   * Tears the producer/viewer session down and returns a handle that settles
   * once the final `stopped` frame has been handed to the WebSocket.
   *
   * Callers that also tear the socket down (SyncWrapperService
   * .disconnectWebSocket) MUST wait for this handle: the frame cannot be sent
   * synchronously (key resolution + WebCrypto encryption are async), so
   * closing the socket in the same tick drops it and leaves other devices on
   * a phantom session — "Tracking" for up to 90s, a snapshot for up to 30min.
   * Teardown itself is synchronous and always completes.
   */
  stop(): Promise<void> {
    // A live producer session must announce its end before teardown. Best-effort
    // via the serialized send path (_broadcastState catches send errors).
    if (this._current.state === 'tracking' || this._current.reason === 'idle') {
      this._current = { state: 'stopped', taskId: null };
      this._lastTrackedTaskId = null;
      this._focusCycle = undefined;
      this._broadcastState();
    }
    // The tail of the serialized send chain, i.e. the frame just enqueued.
    // `_send` keeps this chain always-resolving, so it cannot hang teardown.
    const flushed = this._sendChain;
    this._subs?.unsubscribe();
    this._subs = null;
    this._connEffect?.destroy();
    this._connEffect = null;
    this._wasConnected = false;
    this._pendingResend = false;
    this._stopHeartbeat();
    this._setRemoteSession(null);
    this._lastOrdinal = 0;
    return flushed;
  }

  ngOnDestroy(): void {
    void this.stop();
  }

  /**
   * Requests a stop of the session currently shown as `remoteSession`.
   * CAS-guarded: the command names the session, and the producer ignores it
   * (rebroadcasting its actual state) if it has moved on. The viewer's UI is
   * cleared by the producer's `stopped` ack broadcast, not optimistically.
   */
  requestRemoteStop(): void {
    const rs = this.remoteSession();
    if (!rs || rs.payload.state !== 'tracking') {
      return;
    }
    const cmd: OutboundCmd = {
      v: 1,
      cmd: 'stop',
      sessionId: rs.payload.sessionId,
    };
    this._send('presence_cmd', cmd).catch((err) =>
      SyncLog.warn('TrackingPresenceService: Failed to send stop cmd', err),
    );
  }

  // ----------------------------------------------------------------------
  // Producer side
  // ----------------------------------------------------------------------

  private _onLocalChange(derived: LocalDerivedState): void {
    this._focusCycle = derived.isFocusRunning ? derived.focusCycle : undefined;

    if (derived.taskId) {
      const isNewSession =
        this._current.state !== 'tracking' || this._current.taskId !== derived.taskId;
      if (isNewSession) {
        this._sessionId = nanoid();
        this._sinceTs = Date.now();
      }
      this._lastTrackedTaskId = derived.taskId;
      this._current = { state: 'tracking', taskId: derived.taskId };
      this._startHeartbeat();
      this._broadcastState();
      return;
    }

    const wasTracking = this._current.state === 'tracking';
    const wasIdlePaused = this._current.reason === 'idle';
    // 'idle' is only claimed when the idle event interrupted (or continues
    // interrupting) a live session — an idle episode hours after a manual
    // stop must not resurrect the old task on other devices.
    const reason =
      derived.isIdle && (wasTracking || wasIdlePaused) ? ('idle' as const) : undefined;
    const next: LocalSession = {
      state: 'stopped',
      taskId: reason ? this._lastTrackedTaskId : null,
      reason,
    };
    const reasonChanged = this._current.reason !== next.reason;
    this._current = next;
    if (reason) {
      // Keep announcing during an idle pause: real pauses run for minutes,
      // and without a heartbeat viewers' 90s staleness window would decay
      // "Paused" into "Was tracking" while the producer sits right there.
      this._startHeartbeat();
    } else {
      this._stopHeartbeat();
      this._lastTrackedTaskId = null;
    }

    // Broadcasting `stopped` is only this device's business if it was the one
    // tracking (or its idle pause is ending/starting) — see class invariants.
    if (!wasTracking && !reasonChanged) {
      return;
    }
    if (this._suppressNextStopBroadcast) {
      this._suppressNextStopBroadcast = false;
      return;
    }
    this._broadcastState();
  }

  private _broadcastState(): void {
    if (!this._sessionId) {
      // Never tracked on this device in this app run — nothing to announce.
      return;
    }
    const payload: OutboundPayload = {
      v: 1,
      sessionId: this._sessionId,
      seq: ++this._seq,
      state: this._current.state,
      ...(this._current.reason ? { reason: this._current.reason } : {}),
      taskId: this._current.taskId,
      sinceTs: this._sinceTs,
      ...(this._focusCycle !== undefined ? { focusCycle: this._focusCycle } : {}),
    };
    this._send('presence_state', payload).catch((err) =>
      SyncLog.warn('TrackingPresenceService: Failed to broadcast state', err),
    );
  }

  private _startHeartbeat(): void {
    if (this._heartbeatTimer) {
      return;
    }
    this._heartbeatTimer = setInterval(() => {
      if (this._current.state === 'tracking' || this._current.reason === 'idle') {
        this._broadcastState();
      }
    }, PRESENCE_HEARTBEAT_MS);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ----------------------------------------------------------------------
  // Viewer side
  // ----------------------------------------------------------------------

  private async _onPresenceMessage(msg: PresenceWsMessage): Promise<void> {
    const parsed = await this._decode(msg.payload);
    if (!parsed) {
      return;
    }
    if (msg.kind === 'cmd') {
      this._onRemoteCmd(parsed as TrackingPresenceCmd);
      return;
    }
    this._onRemoteState(parsed as TrackingPresencePayload, msg);
  }

  private _onRemoteState(
    p: TrackingPresencePayload,
    msg: Extract<PresenceWsMessage, { kind: 'state' }>,
  ): void {
    if (
      p.v !== 1 ||
      typeof p.sessionId !== 'string' ||
      (p.state !== 'tracking' && p.state !== 'stopped') ||
      typeof p.seq !== 'number' ||
      !Number.isFinite(p.sinceTs) ||
      (p.taskId !== null && typeof p.taskId !== 'string')
    ) {
      return;
    }
    p.deviceLabel = sanitizeDeviceLabel(p.deviceLabel);
    if (!Number.isFinite(p.focusCycle as number)) {
      delete p.focusCycle;
    }
    if (p.reason !== 'idle') {
      // Only the literal 'idle' may skip the stopped-linger clear — any
      // fabricated reason would pin a stopped session for the full 30min
      // hide window.
      delete p.reason;
    }
    // Server-assigned ordinal orders states across producers without trusting
    // device clocks. Equal ordinals are re-announcements of the same state
    // (producerConnected flag flips) and must pass.
    if (msg.ordinal < this._lastOrdinal) {
      return;
    }
    this._lastOrdinal = msg.ordinal;
    const existing = this.remoteSession();
    if (
      existing &&
      existing.payload.sessionId === p.sessionId &&
      p.seq < existing.payload.seq
    ) {
      return;
    }

    if (p.state === 'tracking' && this._current.state === 'tracking') {
      this._resolveTakeover(p, msg.producerConnected);
      return;
    }

    this._setRemoteSession({
      payload: p,
      producerConnected: msg.producerConnected,
      receivedAt: Date.now(),
    });

    // Plain `stopped` lingers briefly so a task switch (stop+start within
    // seconds) mutates the surface in place instead of flapping it away.
    // An idle pause (`reason: 'idle'`) stays visible as "Paused".
    if (p.state === 'stopped' && !p.reason) {
      this._lingerTimer = setTimeout(() => {
        this._lingerTimer = null;
        this._setRemoteSession(null);
      }, PRESENCE_STOPPED_LINGER_MS);
    }
  }

  /**
   * Both this device and a remote one claim to be tracking. Exactly one may
   * win (one active session account-wide). The later-started session wins;
   * sessionId compare breaks exact ties deterministically on both ends.
   * Losing is loud and reversible: an attributed snack with a one-tap
   * take-back — silent stops read as data-loss bugs.
   */
  private _resolveTakeover(p: TrackingPresencePayload, producerConnected: boolean): void {
    const remoteWins =
      p.sinceTs > this._sinceTs ||
      (p.sinceTs === this._sinceTs && p.sessionId > this._sessionId);
    if (!remoteWins) {
      // We are newer — re-announce so the other device take-over-stops itself
      // and the server cache is corrected.
      this._broadcastState();
      return;
    }
    const prevTaskId = this._current.taskId;
    this._suppressNextStopBroadcast = true;
    this._store.dispatch(setCurrentTask({ id: null }));
    this._snackService.open({
      msg: T.F.TRACKING_PRESENCE.S.MOVED_TO,
      translateParams: { device: p.deviceLabel },
      actionStr: T.F.TRACKING_PRESENCE.S.TRACK_HERE_AGAIN,
      actionFn: () => {
        if (prevTaskId) {
          this._store.dispatch(setCurrentTask({ id: prevTaskId }));
        }
      },
    });
    this._setRemoteSession({
      payload: p,
      producerConnected,
      receivedAt: Date.now(),
    });
  }

  private _onRemoteCmd(cmd: TrackingPresenceCmd): void {
    if (cmd.v !== 1 || cmd.cmd !== 'stop' || typeof cmd.sessionId !== 'string') {
      return;
    }
    cmd.deviceLabel = sanitizeDeviceLabel(cmd.deviceLabel);
    if (this._current.state !== 'tracking') {
      return;
    }
    if (cmd.sessionId !== this._sessionId) {
      // CAS mismatch: the viewer acted on an outdated session (we switched
      // tasks since). Never stop — correct the viewer instead.
      this._broadcastState();
      return;
    }
    this._store.dispatch(setCurrentTask({ id: null }));
    this._snackService.open({
      msg: T.F.TRACKING_PRESENCE.S.STOPPED_FROM,
      translateParams: { device: cmd.deviceLabel },
    });
  }

  /**
   * Single write path for `remoteSession`: resets the linger/hide timers and
   * runs the staleness ticker only while something is actually shown. The
   * hide timer guarantees a session nobody refreshes disappears — and with
   * it every downstream timer/effect — instead of lingering forever.
   */
  private _setRemoteSession(rs: RemoteTrackingSession | null): void {
    if (this._lingerTimer) {
      clearTimeout(this._lingerTimer);
      this._lingerTimer = null;
    }
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    this.remoteSession.set(rs);
    if (rs) {
      this._hideTimer = setTimeout(() => {
        this._hideTimer = null;
        this._setRemoteSession(null);
      }, PRESENCE_HIDE_STALE_AFTER_MS);
      if (!this._viewTicker) {
        this._viewTicker = setInterval(() => this._viewNow.set(Date.now()), VIEW_TICK_MS);
      }
    } else if (this._viewTicker) {
      clearInterval(this._viewTicker);
      this._viewTicker = null;
    }
  }

  // ----------------------------------------------------------------------
  // Wire encoding — opaque envelope, E2E-encrypted when a key is configured
  // ----------------------------------------------------------------------

  private _sendChain: Promise<void> = Promise.resolve();

  private _send(
    type: 'presence_state' | 'presence_cmd',
    obj: OutboundPayload | OutboundCmd,
  ): Promise<void> {
    // Serialized: encrypt latency varies (cold key derivation), and an older
    // `tracking` finishing after a newer `stopped` would leave a phantom
    // session in the single-slot server cache.
    const next = this._sendChain.then(() => this._doSend(type, obj));
    this._sendChain = next.catch(() => undefined);
    return next;
  }

  private async _doSend(
    type: 'presence_state' | 'presence_cmd',
    obj: OutboundPayload | OutboundCmd,
  ): Promise<void> {
    if (!this._ws.isConnected()) {
      // `_subs` is the running latch (see start()): a send enqueued before
      // stop() can land here after it, and there is no reconnect handler left
      // to flush the flag — it would only leak into the next start().
      if (type === 'presence_state' && this._subs) {
        // Remember that a transition was dropped so the reconnect handler can
        // announce it — else a stop made offline leaves a phantom session.
        this._pendingResend = true;
      }
      return;
    }
    let key: string | undefined;
    try {
      key = await this._getEncryptKey();
    } catch (err) {
      // Fail closed: never fall back to plaintext when the key merely failed
      // to resolve — drop the message; the next transition/heartbeat retries.
      SyncLog.warn(
        'TrackingPresenceService: Encrypt key unresolved — dropping send',
        err,
      );
      return;
    }
    // Resolved per frame, not cached: a device renamed in settings announces
    // its new name on the next transition/heartbeat without a restart.
    const frame: TrackingPresencePayload | TrackingPresenceCmd = {
      ...obj,
      deviceLabel: await this._getDeviceLabel(),
    };
    const envelope: TrackingPresenceEnvelope = key
      ? { enc: true, data: await this._encryption.encryptPayload(frame, key) }
      : { enc: false, data: JSON.stringify(frame) };
    this._ws.sendPresence(type, JSON.stringify(envelope));
  }

  /**
   * The user's per-device name from the SuperSync private config, else the
   * platform default. Must not drop the frame on its own account (the key
   * step above already fails closed): the label is decoration, the state
   * transition is the point, so a read failure degrades to the default.
   */
  private async _getDeviceLabel(): Promise<string> {
    try {
      const cfg = await this._providerManager.getProviderConfig(SyncProviderId.SuperSync);
      return resolveDeviceLabel(cfg?.deviceName);
    } catch (err) {
      SyncLog.warn(
        'TrackingPresenceService: Device name unresolved — using platform label',
        err,
      );
      return getDeviceLabel();
    }
  }

  private async _decode(payloadStr: string): Promise<unknown | null> {
    let envelope: TrackingPresenceEnvelope;
    try {
      envelope = JSON.parse(payloadStr);
    } catch {
      return null;
    }
    if (typeof envelope?.data !== 'string') {
      return null;
    }
    try {
      const key = await this._getEncryptKey();
      if (envelope.enc) {
        if (!key) {
          SyncLog.warn(
            'TrackingPresenceService: Encrypted presence received but no key configured',
          );
          return null;
        }
        return await this._encryption.decryptPayload(envelope.data, key);
      }
      if (key) {
        // Encryption is configured: refuse plaintext — a hostile server could
        // otherwise inject fabricated presence states around the E2EE.
        return null;
      }
      return JSON.parse(envelope.data);
    } catch (err) {
      SyncLog.warn('TrackingPresenceService: Failed to decode presence payload', err);
      return null;
    }
  }

  /** Throws when key resolution fails — callers decide the fail-closed path. */
  private async _getEncryptKey(): Promise<string | undefined> {
    const provider = await this._providerManager.getProviderById(
      SyncProviderId.SuperSync,
    );
    return provider && isOperationSyncCapable(provider) && provider.getEncryptKey
      ? await provider.getEncryptKey()
      : undefined;
  }
}
