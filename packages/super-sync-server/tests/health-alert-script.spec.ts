import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(currentDir, '../scripts/health-alert.sh');
const DEPLOY_SCRIPT = join(currentDir, '../scripts/deploy.sh');

const FAKE_DOCKER = `#!/bin/sh
set -u
printf '%s\n' "$*" >> "$FAKE_STATE/docker.log"

if [ "\${1:-}" = "info" ]; then
  exit "\${FAKE_DOCKER_INFO_EXIT:-0}"
fi

if [ "\${1:-}" = "inspect" ]; then
  printf '0\n'
  exit 0
fi

if [ "\${1:-}" != "compose" ]; then
  exit 99
fi
shift

if [ "\${1:-}" = "ps" ]; then
  case "$*" in
    *"{{.State}}"*) printf 'running\n' ;;
    *"{{.Health}}"*) printf 'healthy\n' ;;
    *" -q "*|"ps -q "*) printf 'id-%s\n' "\${3:-\${2:-unknown}}" ;;
  esac
  exit 0
fi

if [ "\${1:-}" = "exec" ]; then
  [ "\${FAKE_DB_EXIT:-0}" = "0" ] || exit "$FAKE_DB_EXIT"
  if [ "\${FAKE_DB_MALFORMED:-0}" = "1" ]; then
    printf 'not monitor data\n'
    exit 0
  fi
  printf 'LONG_Q=%s\n' "\${FAKE_LONG_Q:-0}"
  printf 'LONGEST=%s\n' "\${FAKE_LONGEST-0}"
  printf 'POOL_IN_USE=%s\n' "\${FAKE_POOL_IN_USE:-0}"
  printf 'POOL_LIMIT=%s\n' "\${FAKE_POOL_LIMIT-60}"
  printf 'BAD_INDEX=%s\n' "\${FAKE_BAD_INDEX-}"
  exit 0
fi

exit 99
`;

const FAKE_CURL = `#!/bin/sh
printf '%s' "\${FAKE_HTTP_CODE:-200}"
`;

const FAKE_DF = `#!/bin/sh
printf 'Use%%\n%s%%\n' "\${FAKE_DISK_PCT:-10}"
`;

const FAKE_MAIL = `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_STATE/mail.args"
printf '%s\n' '---MAIL---' >> "$FAKE_STATE/mail.log"
cat >> "$FAKE_STATE/mail.log"
exit "\${FAKE_MAIL_EXIT:-0}"
`;

interface RunResult {
  status: number;
  output: string;
  dockerLog: string;
  mailLog: string;
}

let projectDir: string;
let binDir: string;

const readStateFile = (name: string): string => {
  try {
    return readFileSync(join(projectDir, '.health-alert', name), 'utf8');
  } catch {
    return '';
  }
};

const writeExecutable = (name: string, contents: string): void => {
  const path = join(binDir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

const run = (env: Record<string, string> = {}): RunResult => {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    COMPOSE_DIR: projectDir,
    HEALTH_URL: 'https://health.test/health',
    ALERT_EMAIL: 'ops@example.test',
    FAKE_STATE: join(projectDir, '.health-alert'),
    ...env,
  };

  for (const name of ['POSTGRES_SERVICE', 'MAX_QUERY_SECONDS', 'POOL_WARN_PCT']) {
    if (!(name in env)) {
      delete childEnv[name];
    }
  }

  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: childEnv,
    timeout: 10_000,
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    dockerLog: readStateFile('docker.log'),
    mailLog: readStateFile('mail.log'),
  };
};

const runDeployMonitoringStatus = (): string => {
  const deployScript = readFileSync(DEPLOY_SCRIPT, 'utf8');
  const match = deployScript.match(/report_monitoring_status\(\) \{[\s\S]*?\n\}/);
  expect(match).not.toBeNull();

  const runner = join(projectDir, 'report-monitoring-status.sh');
  writeFileSync(runner, `${match?.[0] ?? ''}\nreport_monitoring_status\n`);
  writeExecutable('crontab', '#!/bin/sh\nexit 1\n');

  const result = spawnSync('bash', [runner], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      SERVER_DIR: projectDir,
    },
  });

  expect(result.status).toBe(0);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
};

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'sup-health-project-'));
  binDir = mkdtempSync(join(tmpdir(), 'sup-health-bin-'));
  writeFileSync(join(projectDir, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(projectDir, '.env'), 'DOMAIN=sync.example.test\n');
  writeExecutable('docker', FAKE_DOCKER);
  writeExecutable('curl', FAKE_CURL);
  writeExecutable('df', FAKE_DF);
  writeExecutable('mail', FAKE_MAIL);
  writeExecutable('journalctl', '#!/bin/sh\nexit 0\n');
  writeExecutable('mountpoint', '#!/bin/sh\nexit 1\n');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

describe('health-alert.sh configuration', () => {
  it.each(['0', '-1', '1.5', 'abc', '2147483648', '99999999999999999999'])(
    'alerts without probing the database for invalid MAX_QUERY_SECONDS=%s',
    (value) => {
      const result = run({ MAX_QUERY_SECONDS: value });

      expect(result.mailLog).toContain(
        'MAX_QUERY_SECONDS must be an integer from 1 to 2147483647',
      );
      expect(result.dockerLog).not.toContain(' psql ');
      expect(result.dockerLog).not.toContain(' node -e ');
    },
  );

  it('accepts the PostgreSQL integer upper bound for MAX_QUERY_SECONDS', () => {
    const result = run({ MAX_QUERY_SECONDS: '2147483647' });

    expect(result.output).not.toContain('MAX_QUERY_SECONDS must be');
    expect(result.dockerLog).toContain(' node -e ');
  });

  it.each(['0', '101', '75.5', 'abc'])(
    'alerts without probing the database for invalid POOL_WARN_PCT=%s',
    (value) => {
      const result = run({ POOL_WARN_PCT: value });

      expect(result.mailLog).toContain('POOL_WARN_PCT must be an integer from 1 to 100');
      expect(result.dockerLog).not.toContain(' psql ');
      expect(result.dockerLog).not.toContain(' node -e ');
    },
  );
});

describe('health-alert.sh service and database monitoring', () => {
  it('keeps the embedded Node probe syntactically valid', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const match = script.match(/DB_PROBE_JS=\$\(cat <<'NODE'\n([\s\S]*?)\nNODE\n\)/);

    expect(match).not.toBeNull();
    const result = spawnSync(process.execPath, ['--check', '-'], {
      input: match?.[1] ?? '',
      encoding: 'utf8',
    });
    expect(`${result.stdout}${result.stderr}`).toBe('');
    expect(result.status).toBe(0);
  });

  it('checks the bundled postgres service by default', () => {
    const result = run();

    expect(result.dockerLog).toContain('compose ps --format {{.State}} postgres');
  });

  it('honors an explicitly empty POSTGRES_SERVICE for an external database', () => {
    const result = run({ POSTGRES_SERVICE: '' });

    expect(result.dockerLog).not.toContain('compose ps --format {{.State}} postgres');
  });

  it('honors POSTGRES_SERVICE= from .env', () => {
    writeFileSync(
      join(projectDir, '.env'),
      'DOMAIN=sync.example.test\nPOSTGRES_SERVICE=\n',
    );

    const result = run();

    expect(result.dockerLog).not.toContain('compose ps --format {{.State}} postgres');
  });

  it('runs probes with Prisma inside the supersync container', () => {
    const result = run({ POSTGRES_SERVICE: '' });
    const script = readFileSync(SCRIPT, 'utf8');

    expect(result.dockerLog).toContain('compose exec -T');
    expect(result.dockerLog).toContain('supersync timeout 18 node -e');
    expect(script).toMatch(/DB_OUTPUT=\$\(timeout -k 5 20 docker compose exec/);
    expect(result.dockerLog).toContain("require('@prisma/client')");
    expect(result.dockerLog).toContain('searchParams.getAll(');
    expect(result.dockerLog).not.toContain(' psql ');
  });

  it('alerts once when the database probe fails and still runs checks 4 and 5', () => {
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_HTTP_CODE: '503',
      FAKE_DISK_PCT: '90',
    });

    expect(result.mailLog).toContain('Database monitoring checks failed');
    expect(result.mailLog.match(/Database monitoring checks failed/g)).toHaveLength(1);
    expect(result.mailLog).toContain('Health endpoint returned HTTP 503');
    expect(result.mailLog).toContain('Disk usage at 90% on /');
  });

  it('treats malformed probe output as a database monitoring failure', () => {
    const result = run({ FAKE_DB_MALFORMED: '1' });

    expect(result.mailLog).toContain('Database monitoring checks failed');
  });

  it.each(['', 'not-a-number', '0'])(
    'alerts when the running DATABASE_URL connection_limit is %j',
    (poolLimit) => {
      const result = run({ FAKE_POOL_IN_USE: '120', FAKE_POOL_LIMIT: poolLimit });

      expect(result.mailLog).toContain('DATABASE_URL has no valid connection_limit');
      expect(result.mailLog).not.toContain('Connection pool');
      expect(result.mailLog).not.toContain('measured against max_connections');
      expect(result.dockerLog).not.toContain('max_connections');
    },
  );

  it('alerts when connections in use reach the configured pool percentage', () => {
    const result = run({
      FAKE_POOL_IN_USE: '45',
      FAKE_POOL_LIMIT: '60',
      POOL_WARN_PCT: '75',
    });

    expect(result.mailLog).toContain(
      'Connection pool 75% saturated (45 in use / 60 limit)',
    );
  });

  it('scopes SQL away from migrators and transient or non-operations indexes', () => {
    const result = run();

    expect(result.status).toBe(0);
    expect(result.dockerLog).toContain('SET LOCAL statement_timeout');
    expect(result.dockerLog).toContain('timeout: 12000');
    expect(result.dockerLog).toContain(
      "application_name NOT LIKE 'supersync-migrator-%'",
    );
    expect(result.dockerLog).toContain('datname = current_database()');
    expect(result.dockerLog).toContain('usename = current_user');
    expect(result.dockerLog).toContain('pg_stat_progress_create_index');
    expect(result.dockerLog).toContain('JOIN pg_locks l');
    expect(result.dockerLog).toContain("'operations'::regclass");
    expect(result.dockerLog).not.toContain("'public.operations'::regclass");
    expect(result.dockerLog).toContain('p.index_relid = i.indexrelid');
    expect(result.dockerLog).toContain('l.relation = i.indexrelid');
    expect(result.dockerLog).toContain("l.mode = 'ShareUpdateExclusiveLock'");
    expect(result.dockerLog).toContain("application_name LIKE 'supersync-migrator-%'");
  });

  it('reports invalid operations indexes returned by the probe', () => {
    const result = run({ FAKE_BAD_INDEX: 'operations_entity_ids_gin' });

    expect(result.mailLog).toContain(
      'Invalid/unusable index(es) present: operations_entity_ids_gin',
    );
  });

  it('treats an empty longest-query duration as malformed probe output', () => {
    const result = run({ FAKE_LONGEST: '' });

    expect(result.mailLog).toContain('Database monitoring checks failed');
  });
});

describe('health-alert.sh state handling', () => {
  it('deduplicates volatile long-query counts and durations', () => {
    run({ FAKE_LONG_Q: '1', FAKE_LONGEST: '130' });
    const second = run({ FAKE_LONG_Q: '27', FAKE_LONGEST: '240' });

    expect(second.mailLog.match(/SuperSync health check failed/g)).toHaveLength(1);
    expect(second.mailLog).toContain('longest: 130s');
  });

  it('sends recovery after mail failure and clears the sticky marker', () => {
    const failed = run({
      FAKE_LONG_Q: '1',
      FAKE_LONGEST: '130',
      FAKE_MAIL_EXIT: '1',
    });
    expect(failed.output).toContain('Failed to send alert email');
    expect(existsSync(join(projectDir, '.health-alert', 'mail-failed'))).toBe(true);

    const recovered = run();
    expect(recovered.mailLog).toContain('All checks passing.');
    expect(existsSync(join(projectDir, '.health-alert', 'mail-failed'))).toBe(false);
  });

  it('retries failed delivery when an earlier problem remains active', () => {
    run({ FAKE_BAD_INDEX: 'index-a' });
    run({
      FAKE_BAD_INDEX: 'index-a',
      FAKE_LONG_Q: '1',
      FAKE_LONGEST: '130',
      FAKE_MAIL_EXIT: '1',
    });
    expect(existsSync(join(projectDir, '.health-alert', 'mail-failed'))).toBe(true);

    const retried = run({ FAKE_BAD_INDEX: 'index-a' });
    expect(retried.mailLog.match(/SuperSync health check failed/g)).toHaveLength(3);
    expect(existsSync(join(projectDir, '.health-alert', 'mail-failed'))).toBe(false);

    const deduplicated = run({ FAKE_BAD_INDEX: 'index-a' });
    expect(deduplicated.mailLog.match(/SuperSync health check failed/g)).toHaveLength(3);
  });

  it('reports heartbeat and mail failure even without a current-user cron entry', () => {
    const stateDir = join(projectDir, '.health-alert');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'last-run'), new Date().toISOString());
    writeFileSync(join(stateDir, 'mail-failed'), '2026-07-20T12:00:00Z\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain("not in this user's crontab");
    expect(output).toContain('recent completed run');
    expect(output).toContain('alert email delivery FAILED');
    expect(output).not.toContain('will go unnoticed');
  });
});
