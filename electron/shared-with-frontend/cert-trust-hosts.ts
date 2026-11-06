// Hosts whose invalid (e.g. self-signed) TLS certificates the app accepts: only
// hosts the user typed into their own provider settings (WebDAV, SuperSync,
// self-hosted issue providers, ...). Everything else gets normal validation. #11097

const MAX_HOSTS = 200;
// URL.host output: lowercase hostname / IPv6 literal, optional :port
const HOST_PATTERN = /^[a-z0-9.\-[\]:]{1,260}$/;

const getHttpHost = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    return new URL(value).host || null;
  } catch {
    // not a URL — just some other config string
    return null;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Collects `URL.host` (hostname + non-default port) of every http(s) URL in the
 * given provider configs, checking string fields one nesting level deep so
 * plugin providers' `pluginConfig` is covered.
 */
export const getConfiguredHosts = (configs: readonly unknown[]): string[] => {
  const hosts = new Set<string>();
  const add = (value: unknown): void => {
    const host = getHttpHost(value);
    if (host) {
      hosts.add(host);
    }
  };
  for (const cfg of configs) {
    if (!isObject(cfg)) {
      continue;
    }
    for (const value of Object.values(cfg)) {
      add(value);
      if (isObject(value)) {
        Object.values(value).forEach(add);
      }
    }
  }
  return [...hosts];
};

/** Validates an untrusted IPC payload into the main-process allowlist. */
export const toTrustedHostSet = (payload: unknown): Set<string> => {
  if (!Array.isArray(payload)) {
    return new Set();
  }
  return new Set(
    payload
      .filter((h): h is string => typeof h === 'string' && HOST_PATTERN.test(h))
      .slice(0, MAX_HOSTS),
  );
};

/** True only if the failing request's exact host (incl. port) is allowlisted. */
export const isCertErrorTrusted = (
  url: string,
  trustedHosts: ReadonlySet<string>,
): boolean => {
  try {
    return trustedHosts.has(new URL(url).host);
  } catch {
    // unparsable URL — fail closed
    return false;
  }
};

/** One-shot preload API; claimed by trusted startup code before plugins load. */
export interface CertTrustElectronApi {
  setTrustedHosts(hosts: string[]): void;
}
