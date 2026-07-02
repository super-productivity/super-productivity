export interface StoreReviewPlugin {
  /**
   * Ask the OS to show its native App Store review prompt (iOS,
   * SKStoreReviewController). The system decides whether it actually appears,
   * rate-limits it, and returns no result — so this resolves once the request
   * has been made, regardless of outcome. No-op on non-iOS platforms.
   */
  requestReview(): Promise<void>;
}
