import type {
  PluginDataDestination,
  PluginManifest,
  PluginSharedData,
} from '@super-productivity/plugin-api';
import { T } from '../../t.const';
import { escapeHtml } from '../../util/escape-html';

type Translate = (key: string, params?: Record<string, string>) => string;

const DATA_LABEL_KEYS: Record<PluginSharedData, string> = {
  credentials: T.PLUGINS.DATA_SHARING.CREDENTIALS,
  userText: T.PLUGINS.DATA_SHARING.USER_TEXT,
  taskTitles: T.PLUGINS.DATA_SHARING.TASK_TITLES,
  taskNotes: T.PLUGINS.DATA_SHARING.TASK_NOTES,
  taskSchedule: T.PLUGINS.DATA_SHARING.TASK_SCHEDULE,
  taskStatus: T.PLUGINS.DATA_SHARING.TASK_STATUS,
  timeTracked: T.PLUGINS.DATA_SHARING.TIME_TRACKED,
  projectAndTagNames: T.PLUGINS.DATA_SHARING.PROJECT_AND_TAG_NAMES,
  ids: T.PLUGINS.DATA_SHARING.IDS,
};

export const KNOWN_SHARED_DATA: ReadonlySet<string> = new Set(
  Object.keys(DATA_LABEL_KEYS),
);

const labelList = (values: string[], t: Translate): string => {
  const keys = values.map((v) =>
    KNOWN_SHARED_DATA.has(v)
      ? DATA_LABEL_KEYS[v as PluginSharedData]
      : T.PLUGINS.DATA_SHARING.OTHER,
  );
  return [...new Set(keys)].map((key) => t(key)).join(', ');
};

const destinationHtml = (d: PluginDataDestination, t: Translate): string => {
  const recipient = d.userServer
    ? t(T.PLUGINS.DATA_SHARING.USER_SERVER, { recipient: d.recipient })
    : d.recipient;
  let html = `<strong>${escapeHtml(recipient)}</strong>`;
  if (d.data.length > 0) {
    html += `: ${escapeHtml(labelList(d.data, t))}`;
  }
  if (d.optionalData?.length) {
    const optional = t(T.PLUGINS.DATA_SHARING.ONLY_IF_TURNED_ON, {
      data: labelList(d.optionalData, t),
    });
    html += `. ${escapeHtml(optional)}`;
  }
  // Validation only admits https URLs; re-checked here because the card also renders
  // manifests that were cached before validation existed.
  if (d.privacyPolicyUrl?.startsWith('https://')) {
    html +=
      ` <a href="${escapeHtml(d.privacyPolicyUrl)}" target="_blank" rel="noopener">` +
      `${escapeHtml(t(T.PLUGINS.DATA_SHARING.PRIVACY_POLICY))}</a>`;
  }
  return `<li>${html}</li>`;
};

/**
 * The user-facing statement of what a plugin sends off the device, as escaped HTML.
 * Empty for a bundled plugin without a declaration (a node test requires one).
 */
export const renderDataSharingHtml = (
  manifest: Pick<PluginManifest, 'dataSharing'>,
  opts: { isBundled: boolean; isChanged?: boolean },
  t: Translate,
): string => {
  const { dataSharing } = manifest;
  if (!Array.isArray(dataSharing) && opts.isBundled) {
    return '';
  }
  const title = t(
    opts.isChanged ? T.PLUGINS.DATA_SHARING.TITLE_CHANGED : T.PLUGINS.DATA_SHARING.TITLE,
  );
  let body: string;
  if (!Array.isArray(dataSharing)) {
    body = `<p>${escapeHtml(t(T.PLUGINS.DATA_SHARING.NOT_DECLARED))}</p>`;
  } else if (dataSharing.length === 0) {
    body = `<p>${escapeHtml(t(T.PLUGINS.DATA_SHARING.NONE))}</p>`;
  } else {
    body = `<ul>${dataSharing.map((d) => destinationHtml(d, t)).join('')}</ul>`;
  }
  const disclaimer = opts.isBundled
    ? ''
    : `<p>${escapeHtml(t(T.PLUGINS.DATA_SHARING.DECLARED_BY_AUTHOR))}</p>`;
  return `<p>${escapeHtml(title)}:</p>${body}${disclaimer}`;
};

/** True when an update changes what the plugin declares it sends. */
export const isDataSharingChanged = (
  installed: Pick<PluginManifest, 'dataSharing'> | undefined,
  next: Pick<PluginManifest, 'dataSharing'>,
): boolean =>
  !!installed &&
  JSON.stringify(installed.dataSharing) !== JSON.stringify(next.dataSharing);
