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

const rules: string[] = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter((e) => e.length > 0);

if (rules.length > 0) {
  Logger.info(`Email allowlist enabled: ${rules.length} rule(s)`);
}

export const isEmailAllowed = (email: string): boolean => {
  if (rules.length === 0) return true;

  const normalized = email.toLowerCase();
  const domain = normalized.split('@')[1];

  return rules.some((rule) =>
    rule.startsWith('*@') ? domain === rule.slice(2) : normalized === rule,
  );
};
