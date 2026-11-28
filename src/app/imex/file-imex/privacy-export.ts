const KEY_TO_REPLACE = [
  'username',
  'userName',
  'loginName',
  'password',
  'token',
  'apiKey',
  'secret',
  'authorization',
  'notes',
  'authCode',
  'accessToken',
  'host',
  'gitlabBaseUrl',
  'nextcloudBaseUrl',
  'apiBaseUrl',
  'serverUrl',
  'icalUrl',
  'organization',
  'syncFilePath',
  'syncFolderPath',
  'title',
  'originalImgPath',
  'path',
  'content',

  'repo',
  'repoFullname',
  'filterUserName',
  'filterUsername',
  'caldavUrl',
  'calendarId',
  'writeCalendarId',
  'timeBlockCalendarId',
  'workSessionCalendarId',
  'api_key',

  // Issue #6020: Additional PII fields
  'resourceName',
  'name',
  'description',
  'location',
  'calProviderId',
  'summary',

  // Calendar regex filter patterns may contain user-specific title fragments
  'filterIncludeRegex',
  'filterExcludeRegex',

  // Agent capture private key (sync.captureKey)
  'privateKeyPkcs8',
];

export const privacyExport = (d: unknown): string => {
  let counter = 0;
  const mask = (key: string, value: unknown): unknown =>
    typeof value === 'string' && value.length ? `${key}__${counter++}` : value;

  return JSON.stringify(d, function (this: Record<string, unknown>, key, value: unknown) {
    if (key === 'readCalendarIds' && Array.isArray(value)) {
      return value.map((id: unknown) => mask(key, id));
    }
    // CalDAV task links contain the calendar and event hrefs, including the account path.
    if (key === 'issueId' && this['issueType'] === 'plugin:caldav-calendar-provider') {
      return mask(key, value);
    }
    return KEY_TO_REPLACE.includes(key) ? mask(key, value) : value;
  });
};
