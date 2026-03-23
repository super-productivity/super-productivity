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

/**
 * Builds a node-fetch–compatible HTTPS agent that respects:
 *  1. Proxy environment variables (HTTPS_PROXY / HTTP_PROXY)
 *  2. An opt-in flag to accept self-signed certificates on the **target** server
 *
 * @param allowSelfSigned  When `true`, TLS certificate errors on both the
 *                         proxy **and** the target connection are ignored.
 *                         This is intentional – the user opted in via the
 *                         provider's "Allow self-signed certificates" setting.
 * @returns An `HttpsProxyAgent`, an `https.Agent`, or `undefined` when neither
 *          a proxy nor self-signed handling is needed.
 */
export const createProxyAwareAgent = (
  allowSelfSigned = false,
): HttpsProxyAgent<string> | HttpsAgent | undefined => {
  const proxyUrl = getProxyUrl();

  if (proxyUrl) {
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
