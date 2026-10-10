/**
 * Whether a request targets a GitLab REST API (gitlab.com or self-hosted).
 * Matched on the path because self-hosted instances use arbitrary hosts and
 * may live under a sub-path (e.g. https://example.com/gitlab/api/v4/).
 */
export const isGitLabApiUrl = (url: string): boolean =>
  new URL(url).pathname.includes('/api/v4/');

/**
 * Non-browser User-Agent for API requests. Bot shields such as Anubis (#10650)
 * challenge any UA containing "Mozilla" and answer with an HTML proof-of-work
 * page instead of JSON.
 */
export const getApiUserAgent = (appVersion: string): string =>
  `SuperProductivity/${appVersion}`;
