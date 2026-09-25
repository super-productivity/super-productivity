/**
 * Extracts the Node probe embedded in `health-alert.sh` so tests run the real thing.
 *
 * Extracted because two specs had hand-written the same heredoc regex three times:
 * renaming `DB_PROBE_JS` or the `NODE` delimiter would have turned one call site into a
 * silent no-op while the others failed loudly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const HEALTH_ALERT_SCRIPT = join(currentDir, '../scripts/health-alert.sh');

export const embeddedProbe = (): string => {
  const script = readFileSync(HEALTH_ALERT_SCRIPT, 'utf8');
  const match = script.match(/DB_PROBE_JS=\$\(cat <<'NODE'\n([\s\S]*?)\nNODE\n\)/);
  if (!match) {
    throw new Error(`No DB_PROBE_JS heredoc found in ${HEALTH_ALERT_SCRIPT}`);
  }
  return match[1];
};
