// Hosts whose invalid (e.g. self-signed) TLS certificates the app accepts: only
// hosts the user typed into their own provider settings (WebDAV, SuperSync,
// self-hosted issue providers, ...). Everything else gets normal validation. #11097

const MAX_HOSTS = 200;
// URL.host output: lowercase hostname / IPv6 literal, optional :port
const HOST_PATTERN = /^[a-z0-9._\-[\]:]{1,260}$/;

// Fields whose value may be a bare host ("gitlab.corp.lan"): providers like
// GitLab prepend https:// themselves. Other fields (e.g. `project: "group/repo"`)
// only count when they carry an explicit http(s) scheme.
const URL_KEY_PATTERN = /(url|host)$/i;

const getHttpHost = (key: string, value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  if (
    !hasHttpScheme &&
    (!URL_KEY_PATTERN.test(key) || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed))
  ) {
    return null;
  }
  try {
    return new URL(hasHttpScheme ? trimmed : `https://${trimmed}`).host || null;
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
 * plugin providers' `pluginConfig` is covered. Values are trimmed; scheme-less
 * values count only in URL/host fields (see URL_KEY_PATTERN).
 */
export const getConfiguredHosts = (configs: readonly unknown[]): string[] => {
  const hosts = new Set<string>();
  const add = (key: string, value: unknown): void => {
    const host = getHttpHost(key, value);
    if (host) {
      hosts.add(host);
    }
  };
  for (const cfg of configs) {
    if (!isObject(cfg)) {
      continue;
    }
    for (const [key, value] of Object.entries(cfg)) {
      add(key, value);
      if (isObject(value)) {
        Object.entries(value).forEach(([k, v]) => add(k, v));
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

/** `URL.host` of a request URL, or null if unparsable. */
export const getUrlHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    // unparsable URL — callers fail closed
    return null;
  }
};

/** True only if the failing request's exact host (incl. port) is allowlisted. */
export const isCertErrorTrusted = (
  url: string,
  trustedHosts: ReadonlySet<string>,
): boolean => {
  const host = getUrlHost(url);
  return host !== null && trustedHosts.has(host);
};

/** One-shot preload API; claimed by trusted startup code before plugins load. */
export interface CertTrustElectronApi {
  /** Resolves once the main process applied the list. */
  setTrustedHosts(hosts: string[]): Promise<void>;
}
