export interface UpdateCheckResult {
  isUpdateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
}

export interface UpdateCheckErrorResult {
  error: string;
}

export type UpdateCheckResponse = UpdateCheckResult | UpdateCheckErrorResult;
