const PRIVATE_IPV4 =
  /^(10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/;

const extractHostname = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`,
    ).hostname;
  } catch {
    return null;
  }
};

/** True for hosts reachable without internet: localhost, private IPs, *.local/*.lan. */
export const isLocalNetworkHost = (value: string | null | undefined): boolean => {
  const host =
    value &&
    extractHostname(value)
      ?.toLowerCase()
      .replace(/^\[|\]$/g, '');
  if (!host) {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host) ||
    PRIVATE_IPV4.test(host)
  );
};

/**
 * True if the config's URL-like string fields (host, baseUrl, ...) all point to
 * the local network, so requests work while the device has no internet.
 */
export const isConfigLocalNetworkOnly = (config: unknown): boolean => {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const urls = Object.entries(config as Record<string, unknown>).filter(
    ([key, value]) => typeof value === 'string' && /(url|host)$/i.test(key) && !!value,
  ) as [string, string][];
  return urls.length > 0 && urls.every(([, value]) => isLocalNetworkHost(value));
};
