interface AuthCacheEntry {
  tokenVersion: number;
  isVerified: boolean;
  expiresAt: number;
}

const AUTH_CACHE_TTL_MS = 30 * 1000;
const AUTH_CACHE_MAX_ENTRIES = 10_000;

class AuthCache {
  private entries = new Map<number, AuthCacheEntry>();

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

  set(userId: number, tokenVersion: number, isVerified: boolean): void {
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
  }

  invalidate(userId: number): void {
    this.entries.delete(userId);
  }

  clear(): void {
    this.entries.clear();
  }
}

// Safe while Helm caps SuperSync at one replica. A future multi-instance rollout
// needs shared invalidation or a lower revocation-lag design.
//
// `isVerified` currently has no verified -> unverified transition; unverified
// passkey registrations are deleted on failure. If verification revocation is
// added later, invalidate this cache beside that write.
export const authCache = new AuthCache();
