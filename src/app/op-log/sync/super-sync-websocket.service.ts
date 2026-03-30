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

  async connect(baseUrl: string, accessToken: string): Promise<void> {
    // Disconnect existing connection first
    this.disconnect();
    this._isIntentionalClose = false;
    this._reconnectAttempts = 0;
    this._currentParams = { baseUrl, accessToken };

    await this._connect(baseUrl, accessToken);
  }

  disconnect(): void {
    this._isIntentionalClose = true;
    this._currentParams = null;
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

  private async _connect(baseUrl: string, accessToken: string): Promise<void> {
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      SyncLog.warn('SuperSyncWebSocketService: No clientId available, cannot connect');
      return;
    }

    // Convert http(s) to ws(s)
    const wsUrl = baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/api/sync/ws?token=${encodeURIComponent(accessToken)}&clientId=${encodeURIComponent(clientId)}`;

    try {
      this._ws = new WebSocket(url);
    } catch (err) {
      SyncLog.warn('SuperSyncWebSocketService: Failed to create WebSocket', err);
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = (): void => {
      SyncLog.log('SuperSyncWebSocketService: Connected');
      this._reconnectAttempts = 0;
      this.isConnected.set(true);
      this._startHeartbeatTimer();
    };

    this._ws.onmessage = (event: MessageEvent): void => {
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

    this._ws.onclose = (event: CloseEvent): void => {
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
      this._scheduleReconnect();
    };

    this._ws.onerror = (): void => {
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
        this._connect(this._currentParams.baseUrl, this._currentParams.accessToken).catch(
          (err) => {
            SyncLog.warn('SuperSyncWebSocketService: Reconnect attempt failed', err);
            this._scheduleReconnect();
          },
        );
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
