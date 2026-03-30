/**
 * Email allowlist for restricting registration.
 *
 * Set ALLOWED_EMAILS env var to a comma-separated list of:
 * - Fully qualified emails: user@example.com
 * - Domain wildcards: *@example.com
 *
 * When unset, all emails are allowed (open registration).
 */
import { Logger } from './logger';

let allowlist: string[] | null = null;

const loadAllowlist = (): string[] | null => {
  if (allowlist !== null) return allowlist.length > 0 ? allowlist : null;

  const raw = process.env.ALLOWED_EMAILS;
  if (!raw) {
    allowlist = [];
    return null;
  }

  allowlist = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (allowlist.length > 0) {
    Logger.info(`Email allowlist enabled: ${allowlist.length} rule(s)`);
  }

  return allowlist.length > 0 ? allowlist : null;
};

export const isEmailAllowed = (email: string): boolean => {
  const rules = loadAllowlist();
  if (!rules) return true;

  const normalized = email.toLowerCase();
  const domain = normalized.split('@')[1];

  return rules.some((rule) => {
    if (rule.startsWith('*@')) {
      return domain === rule.slice(2);
    }
    return normalized === rule;
  });
};
