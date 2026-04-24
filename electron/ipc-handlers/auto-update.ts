import { app, ipcMain } from 'electron';
import fetch from 'node-fetch';
import { error, log } from 'electron-log/main';
import { createProxyAwareAgent } from '../proxy-agent';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import {
  UpdateCheckResponse,
  UpdateCheckResult,
} from '../shared-with-frontend/update-check.model';

interface GitHubLatestReleaseResponse {
  tag_name?: string;
  html_url?: string;
  name?: string;
  message?: string;
}

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/super-productivity/super-productivity/releases/latest';

const _toVersionParts = (version: string): number[] =>
  version
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));

const _isVersionGreater = (latestVersion: string, currentVersion: string): boolean => {
  const latestParts = _toVersionParts(latestVersion);
  const currentParts = _toVersionParts(currentVersion);
  const maxParts = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < maxParts; i++) {
    const latestPart = latestParts[i] ?? 0;
    const currentPart = currentParts[i] ?? 0;

    if (latestPart !== currentPart) {
      return latestPart > currentPart;
    }
  }

  return false;
};

const _getLatestReleaseData = async (): Promise<GitHubLatestReleaseResponse> => {
  const agent = createProxyAwareAgent();
  const headers = {
    Accept: 'application/vnd.github+json',
    ['User-Agent']: `super-productivity/${app.getVersion()}`,
  };

  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers,
    ...(agent ? { agent } : {}),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let errorMessage = response.statusText || 'Failed to check for updates';

    try {
      const parsedResponse = responseText
        ? (JSON.parse(responseText) as GitHubLatestReleaseResponse)
        : undefined;
      errorMessage = parsedResponse?.message || errorMessage;
    } catch {
      errorMessage = responseText || errorMessage;
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as GitHubLatestReleaseResponse;
};

const _createUpdateCheckResult = (
  releaseData: GitHubLatestReleaseResponse,
): UpdateCheckResult => {
  const currentVersion = app.getVersion();
  const latestVersion = releaseData.tag_name || currentVersion;

  return {
    isUpdateAvailable: _isVersionGreater(latestVersion, currentVersion),
    currentVersion,
    latestVersion,
    releaseUrl:
      releaseData.html_url ||
      'https://github.com/super-productivity/super-productivity/releases/latest',
    releaseName: releaseData.name || latestVersion,
  };
};

export const initAutoUpdateIpc = (): void => {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, async (): Promise<UpdateCheckResponse> => {
    try {
      const releaseData = await _getLatestReleaseData();
      return _createUpdateCheckResult(releaseData);
    } catch (err) {
      error('Failed to check for updates', err);
      log('Failed to check for updates', err);

      return {
        error: err instanceof Error ? err.message : 'Failed to check for updates',
      };
    }
  });
};
