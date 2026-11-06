import { App, ipcMain } from 'electron';
import { warn } from 'electron-log/main';
import { IPC } from './shared-with-frontend/ipc-events.const';
import {
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
  ipcMain.on(IPC.SET_CERT_TRUSTED_HOSTS, (event, payload: unknown) => {
    // Secondary guard only — the preload API is one-shot (see consumeCertTrustApi).
    if (event.senderFrame !== event.sender.mainFrame) {
      return;
    }
    trustedHosts = toTrustedHostSet(payload);
  });

  appIN.on('certificate-error', (event, _webContents, url, err, _cert, callback) => {
    if (isCertErrorTrusted(url, trustedHosts)) {
      warn(
        `Accepting certificate error for configured host ${new URL(url).host}: ${err}`,
      );
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
};
