import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { SyncLog } from '../../core/log';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';

export interface NewOpsNotification {
  latestSeq: number;
}

interface WsMessage {
  type: string;
  latestSeq?: number;
  timestamp?: number;
}

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 50;
const JITTER_FACTOR = 0.1;
/** Must be greater than server ping interval (30s) */
const HEARTBEAT_TIMEOUT_MS = 45_000;
/** Close code indicating auth failure - do not reconnect */
const AUTH_FAILURE_CLOSE_CODE = 4003;
/** Close code indicating the server-side per-user connection limit is reached */
const TOO_MANY_CONNECTIONS_CLOSE_CODE = 4008;

@Injectable({
  providedIn: 'root',
})
export class SuperSyncWebSocketService implements OnDestroy {
  private _clientIdProvider = inject(CLIENT_ID_PROVIDER);

  readonly isConnected = signal(false);

  private _newOpsNotification$ = new Subject<NewOpsNotification>();
  readonly newOpsNotification$: Observable<NewOpsNotification> =
    this._newOpsNotification$.asObservable();

  private _ws: WebSocket | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private _isIntentionalClose = false;
  private _currentParams: { baseUrl: string; accessToken: string } | null = null;
  private _connectingPromise: Promise<void> | null = null;
  /** Bumped on every disconnect/_startConnect so an in-flight _connect can detect supersession. */
  private _connectGeneration = 0;

  async connect(baseUrl: string, accessToken: string): Promise<void> {
    if (
      this._currentParams?.baseUrl === baseUrl &&
      this._currentParams.accessToken === accessToken
    ) {
      // An in-flight connect with the same params: share its promise so we don't
      // open a duplicate socket while it is still awaiting clientId/handshake.
      if (this._connectingPromise) {
        return this._connectingPromise;
      }
      if (
        this._ws &&
        (this._ws.readyState === WebSocket.CONNECTING ||
          this._ws.readyState === WebSocket.OPEN)
      ) {
        return;
      }
    }

    // Disconnect existing connection first
    this.disconnect();
    this._isIntentionalClose = false;
    this._reconnectAttempts = 0;
    this._currentParams = { baseUrl, accessToken };

    await this._startConnect(baseUrl, accessToken);
  }

  disconnect(): void {
    this._isIntentionalClose = true;
    this._currentParams = null;
    this._connectingPromise = null;
    this._connectGeneration++;
    this._clearReconnectTimer();
    this._clearHeartbeatTimer();

    if (this._ws) {
      try {
        this._ws.close(1000, 'Client disconnect');
      } catch (err) {
        SyncLog.warn('SuperSyncWebSocketService: Error closing WebSocket', err);
      }
      this._ws = null;
    }
    this.isConnected.set(false);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this._newOpsNotification$.complete();
  }

  private _startConnect(baseUrl: string, accessToken: string): Promise<void> {
    const generation = ++this._connectGeneration;
    const connecting = this._connect(baseUrl, accessToken, generation).finally(() => {
      if (this._connectingPromise === connecting) {
        this._connectingPromise = null;
      }
    });
    this._connectingPromise = connecting;
    return connecting;
  }

  private async _connect(
    baseUrl: string,
    accessToken: string,
    generation: number,
  ): Promise<void> {
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      SyncLog.warn('SuperSyncWebSocketService: No clientId available, cannot connect');
      return;
    }

    // A later disconnect()/_startConnect() bumped the generation while we awaited
    // the clientId — bail before creating an orphan socket.
    if (this._connectGeneration !== generation) {
      SyncLog.log('SuperSyncWebSocketService: Connect superseded before socket creation');
      return;
    }

    // Convert http(s) to ws(s)
    const wsUrl = baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/api/sync/ws?token=${encodeURIComponent(accessToken)}&clientId=${encodeURIComponent(clientId)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      this._ws = ws;
    } catch (err) {
      SyncLog.warn('SuperSyncWebSocketService: Failed to create WebSocket', err);
      this._scheduleReconnect();
      return;
    }

    ws.onopen = (): void => {
      if (this._ws !== ws) {
        return;
      }
      SyncLog.log('SuperSyncWebSocketService: Connected');
      this._reconnectAttempts = 0;
      this.isConnected.set(true);
      this._startHeartbeatTimer();
    };

    ws.onmessage = (event: MessageEvent): void => {
      if (this._ws !== ws) {
        return;
      }
      this._resetHeartbeatTimer();
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        SyncLog.warn('SuperSyncWebSocketService: Received non-JSON message, ignoring');
        return;
      }
      try {
        this._handleMessage(msg);
      } catch (err) {
        SyncLog.err('SuperSyncWebSocketService: Error handling message', err);
      }
    };

    ws.onclose = (event: CloseEvent): void => {
      if (this._ws !== ws) {
        return;
      }
      SyncLog.log(
        `SuperSyncWebSocketService: Closed (code=${event.code}, reason=${event.reason})`,
      );
      this._ws = null;
      this.isConnected.set(false);
      this._clearHeartbeatTimer();

      // Don't reconnect on intentional close or auth failure
      if (this._isIntentionalClose) {
        return;
      }
      if (event.code === AUTH_FAILURE_CLOSE_CODE) {
        SyncLog.warn(
          'SuperSyncWebSocketService: Auth failure, not reconnecting. Waiting for re-auth.',
        );
        return;
      }
      if (event.code === TOO_MANY_CONNECTIONS_CLOSE_CODE) {
        SyncLog.warn(
          'SuperSyncWebSocketService: Server connection limit reached, waiting for periodic sync retry.',
        );
        return;
      }
      this._scheduleReconnect();
    };

    ws.onerror = (): void => {
      if (this._ws !== ws) {
        return;
      }
      // Error is followed by close event, so reconnection is handled there
      SyncLog.warn('SuperSyncWebSocketService: WebSocket error');
    };
  }

  private _handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case 'new_ops':
        if (msg.latestSeq !== undefined) {
          this._newOpsNotification$.next({ latestSeq: msg.latestSeq });
        }
        break;
      case 'ping':
        // Respond with app-level pong
        this._sendMessage({ type: 'pong' });
        break;
      case 'connected':
        SyncLog.log(`SuperSyncWebSocketService: Server confirmed connection`);
        break;
    }
  }

  private _sendMessage(msg: Record<string, unknown>): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(msg));
      } catch (err) {
        SyncLog.warn('SuperSyncWebSocketService: Failed to send message', err);
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this._isIntentionalClose || !this._currentParams) {
      return;
    }
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      SyncLog.warn(
        `SuperSyncWebSocketService: Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
      );
      return;
    }

    this._reconnectAttempts++;
    const baseDelay = Math.min(
      MIN_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    // Add jitter to prevent thundering herd
    // Random value between -1 and 1 for jitter
    const randomFactor = Math.random() * 2 - 1; // eslint-disable-line no-mixed-operators
    const jitter = baseDelay * JITTER_FACTOR * randomFactor;
    const delay = Math.round(baseDelay + jitter);

    SyncLog.log(
      `SuperSyncWebSocketService: Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    );

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._currentParams && !this._isIntentionalClose) {
        this._startConnect(
          this._currentParams.baseUrl,
          this._currentParams.accessToken,
        ).catch((err) => {
          SyncLog.warn('SuperSyncWebSocketService: Reconnect attempt failed', err);
          this._scheduleReconnect();
        });
      }
    }, delay);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _startHeartbeatTimer(): void {
    this._clearHeartbeatTimer();
    this._heartbeatTimer = setTimeout(() => {
      SyncLog.warn(
        'SuperSyncWebSocketService: No heartbeat received, closing connection',
      );
      if (this._ws) {
        try {
          this._ws.close(4000, 'Heartbeat timeout');
        } catch (err) {
          SyncLog.warn(
            'SuperSyncWebSocketService: Error closing on heartbeat timeout',
            err,
          );
        }
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private _resetHeartbeatTimer(): void {
    if (this._heartbeatTimer) {
      this._startHeartbeatTimer();
    }
  }

  private _clearHeartbeatTimer(): void {
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
