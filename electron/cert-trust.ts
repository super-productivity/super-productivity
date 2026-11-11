import { App, ipcMain } from 'electron';
import { warn } from 'electron-log/main';
import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  getUrlHost,
  isCertErrorTrusted,
  toTrustedHostSet,
} from './shared-with-frontend/cert-trust-hosts';

let trustedHosts: ReadonlySet<string> = new Set();

/**
 * Accepts invalid (e.g. self-signed) certificates only for hosts the renderer
 * derived from the user's own provider settings; all other hosts keep normal
 * TLS validation. #11097
 */
export const initCertTrust = (appIN: App): void => {
  // invoke, not send: the renderer awaits this before testing an unsaved config
  ipcMain.handle(IPC.SET_CERT_TRUSTED_HOSTS, (event, payload: unknown) => {
    // Secondary guard only — the preload API is one-shot (see consumeCertTrustApi).
    if (event.senderFrame !== event.sender.mainFrame) {
      return;
    }
    trustedHosts = toTrustedHostSet(payload);
  });

  appIN.on('certificate-error', (event, _webContents, url, err, _cert, callback) => {
    const host = getUrlHost(url);
    if (isCertErrorTrusted(url, trustedHosts)) {
      warn(`Accepting certificate error for configured host ${host}: ${err}`);
      event.preventDefault();
      callback(true);
      return;
    }
    // Self-signed hosts are only trusted once saved in a provider's settings or
    // while their unsaved config is being tested (#11097)
    warn(`Rejecting certificate error for ${host} (not a configured host): ${err}`);
    callback(false);
  });
};
