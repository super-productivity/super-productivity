import { WebSocket } from 'ws';
import { Logger } from '../../logger';

interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  userId: number;
  lastPong: number;
  /** Wall-clock ms when this socket was accepted (used for the storm summary). */
  connectedAt: number;
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
}

/**
 * Manages WebSocket connections for real-time sync notifications.
 *
 * Sends lightweight notifications when new operations are available,
 * prompting clients to download via the existing HTTP endpoint.
 * Does NOT stream operation payloads over WebSocket.
 */
export class WebSocketConnectionService {
  private connections = new Map<number, Set<ConnectedClient>>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

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
      cooldownUntil: nowMs + WebSocketConnectionService.RECONNECT_COOLDOWN_MS,
      refusedChallengers: 0,
      summaryLogged: false,
    };
    userSet.add(client);

    // Send connected message
    this._sendMessage(ws, {
      type: 'connected',
      userId,
      timestamp: Date.now(),
    });

    ws.on('pong', () => {
      client.lastPong = Date.now();
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          client.lastPong = Date.now();
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

  startHeartbeat(): void {
    if (this.heartbeatInterval) return;

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
