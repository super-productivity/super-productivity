import { Agent as HttpsAgent } from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { log } from 'electron-log/main';

/**
 * Reads the proxy URL from standard environment variables.
 * Checks HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy (in that order).
 */
export const getProxyUrl = (): string | undefined =>
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  undefined;

const getNoProxy = (): string | undefined =>
  process.env.NO_PROXY || process.env.no_proxy || undefined;

const getUrlPort = (url: URL): string =>
  url.port || (url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '');

const parseNoProxyEntry = (
  rawEntry: string,
): { host: string; port?: string } | undefined => {
  const entry = rawEntry.trim().toLowerCase();
  if (!entry) {
    return undefined;
  }

  const withoutProtocol = entry.replace(/^[a-z][a-z\d+.-]*:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0];
  const portMatch = withoutPath.match(/:(\d+)$/);
  const port = portMatch?.[1];
  const host = (port ? withoutPath.slice(0, -port.length - 1) : withoutPath).replace(
    /^\[(.*)]$/,
    '$1',
  );

  return host ? { host, port } : undefined;
};

export const isNoProxyMatch = (requestUrl: string, noProxy = getNoProxy()): boolean => {
  if (!noProxy) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }

  const targetHost = url.hostname.toLowerCase();
  const targetPort = getUrlPort(url);

  return noProxy
    .split(/[,\s]+/)
    .map(parseNoProxyEntry)
    .filter((entry): entry is { host: string; port?: string } => !!entry)
    .some(({ host, port }) => {
      if (host === '*') {
        return true;
      }

      if (port && port !== targetPort) {
        return false;
      }

      if (host.startsWith('*.')) {
        const suffix = host.slice(1);
        return targetHost.endsWith(suffix);
      }

      if (host.startsWith('.')) {
        return targetHost === host.slice(1) || targetHost.endsWith(host);
      }

      return targetHost === host || targetHost.endsWith(`.${host}`);
    });
};

/**
 * Builds a node-fetch–compatible HTTPS agent that respects:
 *  1. Proxy environment variables (HTTPS_PROXY / HTTP_PROXY)
 *  2. NO_PROXY / no_proxy bypasses for the current request URL
 *  3. An opt-in flag to accept self-signed certificates on the **target** server
 *
 * @param requestUrl       The URL about to be requested.
 * @param allowSelfSigned  When `true`, TLS certificate errors on both the
 *                         proxy **and** the target connection are ignored.
 *                         This is intentional – the user opted in via the
 *                         provider's "Allow self-signed certificates" setting.
 * @returns An `HttpsProxyAgent`, an `https.Agent`, or `undefined` when neither
 *          a proxy nor self-signed handling is needed.
 */
export const createProxyAwareAgent = (
  requestUrl: string,
  allowSelfSigned = false,
): HttpsProxyAgent<string> | HttpsAgent | undefined => {
  const proxyUrl = getProxyUrl();

  if (proxyUrl && !isNoProxyMatch(requestUrl)) {
    log(`Using proxy.${allowSelfSigned ? ' (self-signed certs allowed)' : ''}`);

    const agent = new HttpsProxyAgent(proxyUrl, {
      // Disables certificate validation for the proxy connection
      ...(allowSelfSigned ? { rejectUnauthorized: false } : {}), // lgtm[js/disabling-certificate-validation]
    });

    if (allowSelfSigned) {
      // Disables certificate validation for the *target* connection.
      // Node's HTTPS stack reads `agent.options` when establishing the final
      // TLS socket through the CONNECT tunnel.
      // CodeQL alert js/disabling-certificate-validation is expected here.
      (agent.options as Record<string, unknown>).rejectUnauthorized = false; // lgtm[js/disabling-certificate-validation]
    }

    return agent;
  }

  if (allowSelfSigned) {
    // No proxy – plain agent that skips certificate validation
    return new HttpsAgent({
      rejectUnauthorized: false, // lgtm[js/disabling-certificate-validation]
    });
  }

  // No proxy, no self-signed override → use Node defaults
  return undefined;
};
