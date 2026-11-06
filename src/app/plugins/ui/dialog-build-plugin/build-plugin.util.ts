import { PluginManifest } from '../../plugin-api.model';
import {
  PLUGIN_API_MEMBER_NAMES,
  unknownPluginApiMemberMessage,
} from '../../util/unknown-plugin-api-member.util';

/**
 * Turns a user's plugin idea into a prompt for an AI chat, and the AI's answer
 * back into plugin files. The prompt rules mirror docs/plugin-development.md
 * § Vibe Coding (the rules AI assistants most often get wrong); keep both in sync.
 */

export type BuildPluginParseErrorKey =
  | 'NO_CODE_BLOCKS'
  | 'NO_MANIFEST'
  | 'INVALID_MANIFEST'
  | 'NO_NAME'
  | 'NO_PLUGIN_CODE';

export interface BuildPluginFiles {
  manifest: PluginManifest;
  pluginJs?: string;
  indexHtml?: string;
}

export type BuildPluginParseResult =
  | { files: BuildPluginFiles }
  | { errorKey: BuildPluginParseErrorKey };

/** Raw link to the plugin API types of this exact release, so the AI builds
 * against the API the user has, not master. */
export const getPluginApiTypesUrl = (appVersion: string): string =>
  `https://raw.githubusercontent.com/super-productivity/super-productivity/v${appVersion}/packages/plugin-api/src/types.ts`;

/**
 * The prompt stays English on purpose: it is read by the AI, not shown in the
 * UI, and AI assistants follow English rules most reliably.
 */
export const buildPluginPrompt = (idea: string, appVersion: string): string =>
  `Write me a plugin for Super Productivity (app version ${appVersion}). It should:

${idea.trim()}

The complete API (the global PluginAPI object): ${getPluginApiTypesUrl(appVersion)}

Rules:

- Only use PluginAPI methods and hooks listed in types.ts. If something is not possible with them, say so instead of inventing a method.
- manifest.json needs id (lowercase letters, numbers and dashes), name, version, "manifestVersion": 1,
  "minSupVersion": "${appVersion}", "hooks": [] and "permissions": [].
- plugin.js is not a module: no import/export, no top-level await. Put async startup code in PluginAPI.onReady(async () => { ... }).
- Header buttons, menu entries, shortcuts and side panel buttons can only be registered from plugin.js, not from index.html.
- A UI goes in index.html with "iFrame": true in the manifest. Inline all CSS and JavaScript; other files are not served to it.
- Hook handlers get one payload object, e.g. registerHook(PluginAPI.Hooks.TASK_COMPLETE, ({ taskId, task }) => { ... }).
- Most methods return Promises: await them.
- Store data with PluginAPI.persistDataSynced(string) and loadSyncedData(), not localStorage.
- PluginAPI.request needs "http" in permissions and the host in "allowedHosts".

Answer with complete files as fenced code blocks: one \`\`\`json block for manifest.json,
one \`\`\`js block for plugin.js and, only if the plugin needs its own UI,
one \`\`\`html block for index.html. No other code blocks.`;

const UNKNOWN_METHOD_REGEX = /\b(?:PluginAPI|plugin)\.(\w+) is not a function/;

/**
 * Message the user pastes back into the AI chat. An invented PluginAPI method
 * is the most common failure (#7173), so it names the closest real ones.
 */
export const buildPluginErrorReport = (
  error: string,
  appVersion: string,
  // the installed plugin's id; null when nothing was installed, so there is nothing to replace
  pluginId: string | null,
): string => {
  const unknownMethod = error.match(UNKNOWN_METHOD_REGEX)?.[1];
  const hint = unknownMethod
    ? `\n${unknownPluginApiMemberMessage(unknownMethod, PLUGIN_API_MEMBER_NAMES, getPluginApiTypesUrl(appVersion))}`
    : '';
  const keepId = pluginId
    ? `\nKeep "id": "${pluginId}" in manifest.json, so the fix replaces the installed plugin.`
    : '';
  return `The plugin failed to load in Super Productivity with this error:

${error}${hint}

Please fix it and send the complete files again, as code blocks like before.${keepId}`;
};

// a fence only closes at the start of a line, so backticks inside the code survive
const CODE_BLOCK_REGEX = /```([\w-]*)[^\n]*\n([\s\S]*?)^[ \t]*```/gm;

const extractCodeBlocks = (answer: string): Map<string, string> => {
  const blocks = new Map<string, string>();
  for (const [, lang, body] of answer.matchAll(CODE_BLOCK_REGEX)) {
    const kind = lang.toLowerCase() === 'javascript' ? 'js' : lang.toLowerCase();
    // first block of a kind wins; later ones are usually usage examples
    if (!blocks.has(kind)) {
      blocks.set(kind, body);
    }
  }
  return blocks;
};

const parseManifest = (json: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // invalid JSON is reported to the user as INVALID_MANIFEST
    return null;
  }
};

const toPluginId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Fills the fields an AI tends to omit, so a small slip doesn't block the
 * install. Everything else is validated by `PluginService.loadPluginFromZip`.
 */
const withManifestDefaults = (
  raw: Record<string, unknown>,
  appVersion: string,
  hasIndexHtml: boolean,
): PluginManifest => {
  const name = typeof raw.name === 'string' ? raw.name : '';
  return {
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: appVersion,
    hooks: [],
    permissions: [],
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : toPluginId(name),
    name,
    ...(hasIndexHtml && raw.iFrame === undefined ? { iFrame: true } : {}),
  } as PluginManifest;
};

/** Parses an AI chat answer (copied as markdown) into plugin files. */
export const parsePluginAnswer = (
  answer: string,
  appVersion: string,
): BuildPluginParseResult => {
  const blocks = extractCodeBlocks(answer);
  if (blocks.size === 0) {
    return { errorKey: 'NO_CODE_BLOCKS' };
  }
  const manifestJson = blocks.get('json');
  if (manifestJson === undefined) {
    return { errorKey: 'NO_MANIFEST' };
  }
  const rawManifest = parseManifest(manifestJson);
  if (!rawManifest) {
    return { errorKey: 'INVALID_MANIFEST' };
  }
  const pluginJs = blocks.get('js');
  const indexHtml = blocks.get('html');
  if (pluginJs === undefined && indexHtml === undefined) {
    return { errorKey: 'NO_PLUGIN_CODE' };
  }
  const manifest = withManifestDefaults(rawManifest, appVersion, indexHtml !== undefined);
  // without a name there is nothing to show or to derive an id from
  if (!manifest.name || !manifest.id) {
    return { errorKey: 'NO_NAME' };
  }
  return { files: { manifest, pluginJs, indexHtml } };
};

/** Packs the files the way an uploaded ZIP would be, for `loadPluginFromZip`. */
export const createPluginZipFile = async (files: BuildPluginFiles): Promise<File> => {
  const { zipSync, strToU8 } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  entries['manifest.json'] = strToU8(JSON.stringify(files.manifest, null, 2));
  if (files.pluginJs !== undefined) {
    entries['plugin.js'] = strToU8(files.pluginJs);
  }
  if (files.indexHtml !== undefined) {
    entries['index.html'] = strToU8(files.indexHtml);
  }
  return new File([zipSync(entries)], `${files.manifest.id}.zip`, {
    type: 'application/zip',
  });
};
