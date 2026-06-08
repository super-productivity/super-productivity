interface AuthCacheEntry {
  tokenVersion: number;
  isVerified: boolean;
  expiresAt: number;
}

const AUTH_CACHE_TTL_MS = 30 * 1000;
const AUTH_CACHE_MAX_ENTRIES = 10_000;

class AuthCache {
  private entries = new Map<number, AuthCacheEntry>();
  private invalidationVersions = new Map<number, number>();

  get(userId: number): AuthCacheEntry | null {
    const entry = this.entries.get(userId);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(userId);
      return null;
    }

    this.entries.delete(userId);
    this.entries.set(userId, entry);
    return entry;
  }

  getInvalidationVersion(userId: number): number {
    return this.invalidationVersions.get(userId) ?? 0;
  }

  setIfCurrent(
    userId: number,
    tokenVersion: number,
    isVerified: boolean,
    expectedInvalidationVersion: number,
  ): boolean {
    if (this.getInvalidationVersion(userId) !== expectedInvalidationVersion) {
      return false;
    }

    this.entries.delete(userId);
    this.entries.set(userId, {
      tokenVersion,
      isVerified,
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    });

    while (this.entries.size > AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    return true;
  }

  set(userId: number, tokenVersion: number, isVerified: boolean): void {
    this.setIfCurrent(
      userId,
      tokenVersion,
      isVerified,
      this.getInvalidationVersion(userId),
    );
  }

  invalidate(userId: number): void {
    const nextVersion = this.getInvalidationVersion(userId) + 1;
    // Re-insert at the tail so the just-invalidated user is the MOST recently
    // used. invalidationVersions must persist after entries.delete() so a
    // verifyToken whose DB read raced this invalidate fails its setIfCurrent CAS
    // and does not cache stale-valid data. Bounding the map is required (it
    // otherwise grows one entry per lifetime-invalidated user, unbounded on a
    // long-lived single replica). Evicting the OLDEST invalidations is safe: an
    // invalidation only needs to survive until the racing in-flight read's
    // setIfCurrent (bounded by one DB round trip). A freshly-invalidated user
    // sits at the MRU tail, so it can only be evicted after every other of the
    // 10k tracked invalidations is newer than it — far beyond any read window.
    this.invalidationVersions.delete(userId);
    this.invalidationVersions.set(userId, nextVersion);
    this.entries.delete(userId);

    while (this.invalidationVersions.size > AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = this.invalidationVersions.keys().next().value;
      if (oldestKey === undefined) break;
      this.invalidationVersions.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
    this.invalidationVersions.clear();
  }
}

// Safe while Helm caps SuperSync at one replica. A future multi-instance rollout
// needs shared invalidation or a lower revocation-lag design.
//
// `isVerified` currently has no verified -> unverified transition; unverified
// passkey registrations are deleted on failure. If verification revocation is
// added later, invalidate this cache beside that write.
export const authCache = new AuthCache();
