import { WebSocket } from 'ws';
import { Logger } from '../../logger';
import { DEVICE_TOUCH_THROTTLE_MS } from '../sync.types';

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  userId: number;
  lastPong: number;
  /** Wall-clock ms when this socket was accepted (used for the storm summary). */
  connectedAt: number;
  /**
   * Wall-clock ms of the last device touch issued for this socket. Purely an
   * in-memory throttle so a long-lived connection costs ~one write per
   * DEVICE_TOUCH_THROTTLE_MS rather than one per heartbeat tick; the statement
   * itself is throttled again in SQL, so a stale value here is harmless.
   */
  lastTouchedAt: number;
  /**
   * Wall-clock ms at which the reconnect cooldown expires. Set on accept and
   * extended forward on each refused challenger so a sustained storm cannot
   * tick the gate out (sliding window). Eviction only allowed once
   * `Date.now() >= cooldownUntil`.
   */
  cooldownUntil: number;
  /** Count of challengers refused during this incumbent's lifetime. */
  refusedChallengers: number;
  /**
   * Set true after `removeConnection` emits the storm-summary INFO. Guards
   * against the inevitable `ws.on('close')` re-entry (triggered by
   * removeConnection's own ws.close — eviction, heartbeat, closeAll) firing
   * the summary a second time. Preferred over zeroing `refusedChallengers`
   * because the count remains observably truthful for the life of the object.
   */
  summaryLogged: boolean;
  /** Start of the current presence rate-limit window (wall-clock ms). */
  presenceWindowStart: number;
  /** Presence messages accepted in the current window. */
  presenceMsgCount: number;
}

/**
 * Last-known ephemeral tracking-presence state of one user. The payload is an
 * opaque string minted by the producing client (E2E-encrypted when the user
 * has encryption on) — the server relays and caches it without ever parsing
 * it. Kept in memory only; dropped when the user's last socket closes.
 */
interface UserPresence {
  /** Opaque payload string from the producing client. Never parsed here. */
  payload: string;
  /**
   * Server-assigned monotonic ordinal (per user). Clients order presence
   * states by this instead of client wall clocks, which skew.
   */
  ordinal: number;
  /** clientId of the socket that produced this state. */
  producerClientId: string;
  /** Wall-clock ms when the state was received. */
  updatedAt: number;
  /**
   * False once the producing socket has closed. A disconnected producer is
   * NOT the same as "stopped" (it may keep tracking offline) — viewers use
   * this to render the state as possibly stale.
   */
  producerConnected: boolean;
}

/**
 * Manages WebSocket connections for real-time sync notifications.
 *
 * Sends lightweight notifications when new operations are available,
 * prompting clients to download via the existing HTTP endpoint.
 * Does NOT stream operation payloads over WebSocket.
 *
 * Also relays ephemeral tracking-presence messages between a user's devices
 * (`presence_state` / `presence_cmd`) with an in-memory last-state cache —
 * payloads stay opaque to the server and nothing touches the database.
 */
export class WebSocketConnectionService {
  private connections = new Map<number, Set<ConnectedClient>>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private presenceByUser = new Map<number, UserPresence>();
  /**
   * Injected rather than imported so this service stays free of persistence:
   * it knows when a client is demonstrably alive, not how a device row is
   * written. Fire-and-forget by contract — the callee must not reject.
   */
  private touchDevice: ((userId: number, clientId: string) => void) | null = null;

  /** 30s ping interval - keeps connection alive through proxies (most: 60-120s timeout) */
  private static readonly PING_INTERVAL_MS = 30_000;
  /** Close connection if no pong within 10s of ping */
  private static readonly PONG_TIMEOUT_MS = 10_000;
  /** Debounce notifications: max 1 per 100ms per user (latest-seq-wins) */
  private static readonly NOTIFY_DEBOUNCE_MS = 100;
  /** Max WebSocket connections per user to prevent resource exhaustion */
  private static readonly MAX_CONNECTIONS_PER_USER = 10;
  /** Close code sent to the stale socket when a new one from the same clientId replaces it */
  private static readonly REPLACED_CLOSE_CODE = 4009;
  /** Close code sent to a challenger socket refused during the reconnect cooldown */
  private static readonly RECONNECT_COOLDOWN_CLOSE_CODE = 4008;
  /**
   * Close code sent to every socket of a user whose tokens were just revoked.
   * Wire contract: 4003 is the auth-failure code — it must stay in step with
   * the upgrade rejection in `websocket.routes.ts` and the client's
   * `AUTH_FAILURE_CLOSE_CODE` (`super-sync-websocket.service.ts`), which
   * treats it as terminal (no auto-reconnect; the next sync reconnects).
   */
  private static readonly TOKEN_REVOKED_CLOSE_CODE = 4003;
  /**
   * Upper bound for a relayed presence payload. Presence states are tiny
   * (session id + task id + labels); anything larger is dropped as abuse.
   * Must stay <= the route-level `maxPayload` in server.ts, which errors the
   * whole socket instead of dropping just the message.
   */
  private static readonly MAX_PRESENCE_PAYLOAD_BYTES = 8_192;
  /**
   * Presence relay rate limit per connection. A well-behaved producer sends
   * transitions plus a 60s heartbeat (~1/min, short takeover bursts), so this
   * is generous — anything sustained above it is a client bug or abuse, and
   * relaying it would amplify to every sibling socket.
   */
  private static readonly PRESENCE_RATE_WINDOW_MS = 10_000;
  private static readonly PRESENCE_RATE_MAX_PER_WINDOW = 15;
  /**
   * Don't send cached presence to newly connecting sockets once it is older
   * than the viewers' own hide window (PRESENCE_HIDE_STALE_AFTER_MS client-
   * side) — clients stamp snapshots with their local receive time, so an
   * old snapshot would otherwise revive as "fresh" on every reconnect.
   */
  private static readonly PRESENCE_SNAPSHOT_MAX_AGE_MS = 30 * 60_000;
  /**
   * Sliding-window cooldown. While a still-OPEN incumbent's `cooldownUntil` is
   * in the future, a new socket from the same clientId is refused (the
   * incumbent is kept, NOT evicted) and `cooldownUntil` is extended by another
   * RECONNECT_COOLDOWN_MS. Eviction only resumes after this long of QUIET (no
   * challengers). Breaks the shared-clientId reconnect storm from pre-18.6.0
   * clients that reconnect immediately on the 4009 eviction: under sustained
   * load the gate never expires, so the server stops emitting 4009 and the
   * loop loses its fuel. A genuinely dead/closing incumbent bypasses this (see
   * addConnection), so a real network-blip reconnect still recovers.
   */
  private static readonly RECONNECT_COOLDOWN_MS = 5_000;

  private pendingNotifications = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      excludeClientIds: Set<string>;
      latestSeq: number;
    }
  >();

  addConnection(userId: number, clientId: string, ws: WebSocket): void {
    // A new socket from the same clientId means the device is reconnecting — the
    // server's old entry is by definition stale (network blip, proxy idle close,
    // OS sleep). Evict it eagerly instead of waiting up to ~40s for the heartbeat
    // cycle; otherwise stale entries pile up to MAX_CONNECTIONS_PER_USER and
    // legitimate reconnects get rejected with 4008.
    const existingSet = this.connections.get(userId);
    if (existingSet) {
      for (const existing of existingSet) {
        if (existing.clientId === clientId) {
          // Reconnect cooldown (sliding window): if the incumbent socket is
          // still OPEN and now < its cooldownUntil, this is a too-fast reconnect
          // (the shared-clientId storm from pre-18.6.0 clients that reconnect
          // immediately on any close frame). Refuse the challenger and KEEP the
          // incumbent untouched — the incumbent is never evicted, so the server
          // stops emitting 4009 and the loop loses its fuel. Each refusal
          // extends cooldownUntil forward so a sustained storm cannot tick the
          // gate out: eviction only resumes after RECONNECT_COOLDOWN_MS of
          // quiet. A dead/closing incumbent falls through to normal eviction so
          // a genuine network-blip reconnect still recovers.
          const now = Date.now();
          if (existing.ws.readyState === WebSocket.OPEN && now < existing.cooldownUntil) {
            existing.cooldownUntil =
              now + WebSocketConnectionService.RECONNECT_COOLDOWN_MS;
            existing.refusedChallengers++;
            // Log only the first refusal per incumbent — a sustained storm
            // produces hundreds of these per second and the only useful signal
            // is "storm started"; the summary on removeConnection reports the
            // total count when this incumbent finally goes away.
            if (existing.refusedChallengers === 1) {
              Logger.warn(
                `[ws:user:${userId}:${clientId}] Reconnect within cooldown; refusing challenger, keeping incumbent`,
              );
            }
            try {
              ws.close(
                WebSocketConnectionService.RECONNECT_COOLDOWN_CLOSE_CODE,
                'Reconnecting too fast',
              );
            } catch (err) {
              Logger.debug(
                `[ws:user:${userId}:${clientId}] Error closing refused challenger`,
                err,
              );
            }
            return;
          }
          Logger.info(
            `[ws:user:${userId}:${clientId}] Replacing stale connection from same client`,
          );
          // `removeConnection` may drop the userId entry from `this.connections`
          // entirely if the set becomes empty; the `!this.connections.has(userId)`
          // check below re-creates it before we add the new client.
          this.removeConnection(userId, existing, {
            code: WebSocketConnectionService.REPLACED_CLOSE_CODE,
            reason: 'Replaced by newer connection',
          });
          break;
        }
      }
    }

    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    const userSet = this.connections.get(userId)!;

    if (userSet.size >= WebSocketConnectionService.MAX_CONNECTIONS_PER_USER) {
      Logger.warn(
        `[ws:user:${userId}] Connection rejected: max connections per user reached`,
      );
      ws.close(4008, 'Too many connections');
      return;
    }
    const nowMs = Date.now();
    const client: ConnectedClient = {
      ws,
      clientId,
      userId,
      lastPong: nowMs,
      connectedAt: nowMs,
      lastTouchedAt: nowMs,
      cooldownUntil: nowMs + WebSocketConnectionService.RECONNECT_COOLDOWN_MS,
      refusedChallengers: 0,
      summaryLogged: false,
      presenceWindowStart: nowMs,
      presenceMsgCount: 0,
    };
    userSet.add(client);

    const presence = this.presenceByUser.get(userId);
    if (presence && presence.producerClientId === clientId) {
      // The presence producer coming back (reconnect after a network blip or
      // socket eviction) restores the connected flag so viewers stop rendering
      // its state as stale; the broadcast goes out immediately rather than
      // waiting up to a heartbeat interval for the producer's next state.
      if (!presence.producerConnected) {
        presence.producerConnected = true;
        this._relayPresence(userId, clientId, this._presenceStateMsg(presence));
      }
    }

    // Send connected message
    this._sendMessage(ws, {
      type: 'connected',
      userId,
      timestamp: Date.now(),
    });

    // Send the cached presence snapshot so a device connecting mid-session
    // immediately sees what another device is tracking. Skipped for the
    // producer itself — its own next state transition/heartbeat is fresher —
    // and for entries the viewer would hide as stale anyway.
    if (
      presence &&
      presence.producerClientId !== clientId &&
      Date.now() - presence.updatedAt <
        WebSocketConnectionService.PRESENCE_SNAPSHOT_MAX_AGE_MS
    ) {
      this._sendMessage(ws, this._presenceStateMsg(presence));
    }

    ws.on('pong', () => {
      client.lastPong = Date.now();
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          client.lastPong = Date.now();
        } else if (msg.type === 'presence_state' || msg.type === 'presence_cmd') {
          this._handlePresenceMessage(client, msg.type, msg.payload);
        }
      } catch (err) {
        Logger.debug(`[ws:user:${userId}:${clientId}] Non-JSON message received`, err);
      }
    });

    ws.on('close', () => {
      this.removeConnection(userId, client);
    });

    ws.on('error', (err: Error) => {
      // Close event follows error — cleanup is handled there
      Logger.warn(`[ws:user:${userId}:${clientId}] WebSocket error: ${err.message}`);
    });

    const userConns = this.connections.get(userId)?.size ?? 0;
    Logger.info(
      `[ws:user:${userId}:${clientId}] Connected (${userConns} total for user)`,
    );
  }

  removeConnection(
    userId: number,
    client: ConnectedClient,
    closeFrame?: { code: number; reason: string },
  ): void {
    const userSet = this.connections.get(userId);
    if (userSet) {
      userSet.delete(client);
      if (userSet.size === 0) {
        this.connections.delete(userId);
      }
    }
    this._onPresenceProducerMaybeGone(userId, client.clientId);
    // Storm summary: the first refusal logged a WARN; the rest were silent.
    // When the incumbent finally goes away, log the cumulative count so the
    // operator sees the scale of the storm without per-attempt log spam.
    // `summaryLogged` guards against the inevitable `ws.on('close')` re-entry
    // (triggered by our own ws.close below) double-logging.
    if (client.refusedChallengers > 0 && !client.summaryLogged) {
      const incumbentLifetimeMs = Date.now() - client.connectedAt;
      Logger.info(
        `[ws:user:${userId}:${client.clientId}] Refused ${client.refusedChallengers} reconnect challenger(s) over ${incumbentLifetimeMs}ms incumbent lifetime before removal`,
      );
      client.summaryLogged = true;
    }
    // Close the WebSocket if still open
    if (
      client.ws.readyState === WebSocket.OPEN ||
      client.ws.readyState === WebSocket.CONNECTING
    ) {
      try {
        if (closeFrame) {
          client.ws.close(closeFrame.code, closeFrame.reason);
        } else {
          client.ws.close();
        }
      } catch (err) {
        Logger.debug(
          `[ws:user:${userId}:${client.clientId}] Error closing connection`,
          err,
        );
      }
    }
  }

  /**
   * Notify all connected clients of a user (except the sender) about new operations.
   * Uses debouncing to prevent notification storms during rapid uploads.
   * Fire-and-forget - does not block the caller.
   */
  notifyNewOps(userId: number, excludeClientId: string, latestSeq: number): void {
    const userSet = this.connections.get(userId);
    if (!userSet || userSet.size === 0) return;

    let pending = this.pendingNotifications.get(userId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.excludeClientIds.add(excludeClientId);
      pending.latestSeq = latestSeq;
    } else {
      pending = {
        timer: null as unknown as ReturnType<typeof setTimeout>,
        excludeClientIds: new Set([excludeClientId]),
        latestSeq,
      };
      this.pendingNotifications.set(userId, pending);
    }

    pending.timer = setTimeout(() => {
      const entry = this.pendingNotifications.get(userId);
      this.pendingNotifications.delete(userId);
      if (entry) {
        this._sendNewOpsNotification(userId, entry.excludeClientIds, entry.latestSeq);
      }
    }, WebSocketConnectionService.NOTIFY_DEBOUNCE_MS);
  }

  private _sendNewOpsNotification(
    userId: number,
    excludeClientIds: Set<string>,
    latestSeq: number,
  ): void {
    const userSet = this.connections.get(userId);
    if (!userSet) return;

    const message = {
      type: 'new_ops',
      latestSeq,
      timestamp: Date.now(),
    };

    let notified = 0;
    for (const client of userSet) {
      if (!excludeClientIds.has(client.clientId)) {
        if (this._sendMessage(client.ws, message)) {
          notified++;
        }
      }
    }

    if (notified > 0) {
      Logger.debug(
        `[ws:user:${userId}] Notified ${notified} client(s) about new ops (seq=${latestSeq})`,
      );
    }
  }

  /**
   * Handles an incoming ephemeral presence message from one of a user's
   * devices. `presence_state` is cached (last-state-wins, server-assigned
   * ordinal) and relayed to the user's other sockets; `presence_cmd` (e.g. a
   * remote stop request) is relayed without caching. Payloads are opaque
   * strings — E2E-encrypted when the user has encryption on — and are never
   * parsed or persisted server-side.
   */
  private _handlePresenceMessage(
    client: ConnectedClient,
    type: 'presence_state' | 'presence_cmd',
    payload: unknown,
  ): void {
    if (typeof payload !== 'string' || payload.length === 0) {
      return;
    }
    if (
      Buffer.byteLength(payload, 'utf8') >
      WebSocketConnectionService.MAX_PRESENCE_PAYLOAD_BYTES
    ) {
      Logger.warn(
        `[ws:user:${client.userId}:${client.clientId}] Oversized ${type} payload dropped`,
      );
      return;
    }

    const now = Date.now();
    if (
      now - client.presenceWindowStart >
      WebSocketConnectionService.PRESENCE_RATE_WINDOW_MS
    ) {
      client.presenceWindowStart = now;
      client.presenceMsgCount = 0;
    }
    if (
      ++client.presenceMsgCount > WebSocketConnectionService.PRESENCE_RATE_MAX_PER_WINDOW
    ) {
      if (
        client.presenceMsgCount ===
        WebSocketConnectionService.PRESENCE_RATE_MAX_PER_WINDOW + 1
      ) {
        Logger.warn(
          `[ws:user:${client.userId}:${client.clientId}] Presence rate limit hit — dropping ${type}`,
        );
      }
      return;
    }

    if (type === 'presence_state') {
      const prev = this.presenceByUser.get(client.userId);
      const presence: UserPresence = {
        payload,
        ordinal: (prev?.ordinal ?? 0) + 1,
        producerClientId: client.clientId,
        updatedAt: Date.now(),
        producerConnected: true,
      };
      this.presenceByUser.set(client.userId, presence);
      this._relayPresence(
        client.userId,
        client.clientId,
        this._presenceStateMsg(presence),
      );
    } else {
      this._relayPresence(client.userId, client.clientId, {
        type: 'presence_cmd',
        payload,
        timestamp: Date.now(),
      });
    }
  }

  /** The one wire shape a cached presence state is announced with. */
  private _presenceStateMsg(p: UserPresence): Record<string, unknown> {
    return {
      type: 'presence_state',
      payload: p.payload,
      ordinal: p.ordinal,
      producerConnected: p.producerConnected,
      timestamp: p.updatedAt,
    };
  }

  private _relayPresence(
    userId: number,
    excludeClientId: string,
    message: Record<string, unknown>,
  ): void {
    const userSet = this.connections.get(userId);
    if (!userSet) {
      return;
    }
    // Serialized once — the identical string goes to every sibling socket.
    const str = JSON.stringify(message);
    for (const c of userSet) {
      if (c.clientId !== excludeClientId && c.ws.readyState === WebSocket.OPEN) {
        try {
          c.ws.send(str);
        } catch (err) {
          Logger.debug(`[ws] Failed to send message`, err);
        }
      }
    }
  }

  /**
   * Called after a socket is removed. If it was the presence producer's last
   * socket, the cached state is flagged `producerConnected: false` and the
   * flag is broadcast, so viewers can render the state as possibly stale —
   * a disconnected producer may still be tracking offline, so the state
   * itself is kept. The whole cache entry is dropped once the user has no
   * sockets left (bounds memory to actively connected users; the producer
   * re-announces on its next heartbeat anyway).
   */
  private _onPresenceProducerMaybeGone(userId: number, clientId: string): void {
    const presence = this.presenceByUser.get(userId);
    if (!presence) {
      return;
    }
    if (!this.connections.has(userId)) {
      this.presenceByUser.delete(userId);
      return;
    }
    if (presence.producerClientId !== clientId || !presence.producerConnected) {
      return;
    }
    // The producer may have just RE-connected: eviction removes the old
    // socket while a live replacement with the same clientId exists.
    let stillConnected = false;
    for (const c of this.connections.get(userId) ?? []) {
      if (c.clientId === clientId) {
        stillConnected = true;
        break;
      }
    }
    if (stillConnected) {
      return;
    }
    presence.producerConnected = false;
    this._relayPresence(userId, clientId, this._presenceStateMsg(presence));
  }

  startHeartbeat(touchDevice?: (userId: number, clientId: string) => void): void {
    if (this.heartbeatInterval) return;
    this.touchDevice = touchDevice ?? null;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const toRemove: { userId: number; client: ConnectedClient }[] = [];

      for (const [userId, userSet] of this.connections) {
        for (const client of userSet) {
          // Check if client responded to last ping
          if (
            now - client.lastPong >
            WebSocketConnectionService.PING_INTERVAL_MS +
              WebSocketConnectionService.PONG_TIMEOUT_MS
          ) {
            Logger.info(
              `[ws:user:${userId}:${client.clientId}] Dead connection (no pong), closing`,
            );
            toRemove.push({ userId, client });
            continue;
          }

          // A socket that still answers pings is in active use, so keep its device
          // row fresh: a connection held open past the retention window without
          // uploading would otherwise be pruned mid-use. Touching only on accept
          // would not cover that case.
          if (
            this.touchDevice &&
            now - client.lastTouchedAt >= DEVICE_TOUCH_THROTTLE_MS
          ) {
            client.lastTouchedAt = now;
            this.touchDevice(userId, client.clientId);
          }

          // Send app-level ping
          this._sendMessage(client.ws, {
            type: 'ping',
            timestamp: now,
          });

          // Also send WebSocket-level ping for proxy keepalive
          if (client.ws.readyState === WebSocket.OPEN) {
            try {
              client.ws.ping();
            } catch {
              Logger.debug(`[ws:user:${userId}:${client.clientId}] Ping failed`);
            }
          }
        }
      }

      for (const { userId, client } of toRemove) {
        this.removeConnection(userId, client);
      }
    }, WebSocketConnectionService.PING_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // Clear pending notifications
    for (const entry of this.pendingNotifications.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingNotifications.clear();
  }

  /**
   * Closes every live socket of one user. Called on token revocation
   * (`POST /api/replace-token`, passkey recovery): sockets are authenticated
   * only at upgrade and kept alive by the heartbeat, so without this a
   * revoked device would keep receiving op notifications indefinitely.
   *
   * Deliberately no caller exemption: a socket's clientId is a self-declared
   * query param, never bound to its token, so sparing a caller-named socket
   * would let a stolen-token client exempt itself by claiming that id. The
   * revoking caller's socket closes too and reconnects with its fresh token
   * on the next sync cycle.
   */
  closeForUser(userId: number): void {
    const userSet = this.connections.get(userId);
    if (!userSet) {
      return;
    }
    // removeConnection mutates the set — iterate a copy.
    for (const client of [...userSet]) {
      this.removeConnection(userId, client, {
        code: WebSocketConnectionService.TOKEN_REVOKED_CLOSE_CODE,
        reason: 'Token revoked',
      });
    }
  }

  /** Close all connections gracefully */
  closeAll(): void {
    for (const [, userSet] of this.connections) {
      for (const client of userSet) {
        try {
          client.ws.close(1001, 'Server shutting down');
        } catch (err) {
          Logger.debug(`[ws] Error closing connection during shutdown`, err);
        }
      }
    }
    this.connections.clear();
    this.presenceByUser.clear();
  }

  /** Get total connection count (for monitoring/health) */
  getConnectionCount(): number {
    let total = 0;
    for (const userSet of this.connections.values()) {
      total += userSet.size;
    }
    return total;
  }

  private _sendMessage(ws: WebSocket, message: Record<string, unknown>): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      Logger.debug(`[ws] Failed to send message`, err);
      return false;
    }
  }
}

// Singleton instance
let wsConnectionService: WebSocketConnectionService | null = null;

export const getWsConnectionService = (): WebSocketConnectionService => {
  if (!wsConnectionService) {
    wsConnectionService = new WebSocketConnectionService();
  }
  return wsConnectionService;
};

export const resetWsConnectionService = (): void => {
  if (wsConnectionService) {
    wsConnectionService.stopHeartbeat();
    wsConnectionService.closeAll();
  }
  wsConnectionService = null;
};
