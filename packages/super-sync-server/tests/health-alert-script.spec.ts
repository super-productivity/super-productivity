import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MONITORING_APPLICATION_NAME } from '../scripts/monitoring-db';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { embeddedProbe, HEALTH_ALERT_SCRIPT } from './health-probe.helper';

const currentDir = dirname(fileURLToPath(import.meta.url));
const DEPLOY_SCRIPT = join(currentDir, '../scripts/deploy.sh');
const BACKUP_SCRIPT = join(currentDir, '../scripts/backup.sh');
// Shared by backup.sh (sets it) and health-alert.sh (exempts it); both are asserted
// against this one literal so the exemption cannot silently drift apart.
const BACKUP_APPLICATION_NAME = 'supersync-backup';

const FAKE_DOCKER = `#!/bin/sh
set -u
printf '%s\n' "$*" >> "$FAKE_STATE/docker.log"

if [ "\${1:-}" = "info" ]; then
  exit "\${FAKE_DOCKER_INFO_EXIT:-0}"
fi

if [ "\${1:-}" = "inspect" ]; then
  printf '%s\n' "\${FAKE_RESTART_COUNT:-0}"
  exit 0
fi

if [ "\${1:-}" = "logs" ]; then
  printf '%b\n' "\${FAKE_PG_LOG-}"
  exit 0
fi

if [ "\${1:-}" != "compose" ]; then
  exit 99
fi
shift

if [ "\${1:-}" = "ps" ]; then
  shift
  # Parse the flags rather than string-matching their spelling: -q and -aq are the same
  # flag to docker, and a fake that treats them as different silently stops exercising a
  # check the moment someone rewrites -q as -aq.
  ALL=0; QUIET=0; FMT=''; SVC=''
  while [ $# -gt 0 ]; do
    case "$1" in
      -a|--all) ALL=1 ;;
      -q|--quiet) QUIET=1 ;;
      -aq|-qa) ALL=1; QUIET=1 ;;
      --format) FMT="$2"; shift ;;
      -*) ;;
      *) SVC="$1" ;;
    esac
    shift
  done

  if [ "$SVC" = "\${FAKE_MISSING_SVC:-}" ]; then
    # A service with no container at all: nothing on stdout, and compose exits 0 when the
    # service is declared, non-zero when it is not known at all.
    printf 'no container for %s\n' "$SVC" >&2
    exit "\${FAKE_MISSING_EXIT:-0}"
  fi

  STATE_OUT=running
  # Single-dash default: an explicitly EMPTY FAKE_HEALTH is the common real case (a service
  # with no healthcheck renders "running|"), so it must not fall back to "healthy".
  HEALTH_OUT="\${FAKE_HEALTH-healthy}"
  EXIT_OUT=0
  if [ "$SVC" = "\${FAKE_STOPPED_SVC:-}" ]; then
    # Without -a, docker compose ps hides a stopped container completely -- from the
    # state query AND from the id query. A stopped container still HAS an id.
    [ "$ALL" = "1" ] || exit 0
    # Real compose renders a BARE 'exited' here; the code lives in its own field.
    STATE_OUT=exited
    HEALTH_OUT=''
    EXIT_OUT="\${FAKE_EXIT_CODE:-128}"
  fi

  # An old compose aborts the ENTIRE render on one unsupported field: empty stdout, exit 1.
  if [ "\${FAKE_NO_EXITCODE_FIELD:-0}" = "1" ]; then
    case "$FMT" in *'{{.ExitCode}}'*) exit 1 ;; esac
  fi

  if [ "$QUIET" = "1" ]; then
    printf 'id-%s\n' "$SVC"
  else
    OUT="$FMT"
    OUT=$(printf '%s' "$OUT" | sed -e "s/{{.State}}/$STATE_OUT/g" \
      -e "s/{{.Health}}/$HEALTH_OUT/g" -e "s/{{.ExitCode}}/$EXIT_OUT/g")
    printf '%s\n' "$OUT"
  fi
  exit 0
fi

if [ "\${1:-}" = "exec" ]; then
  # Real \`docker compose exec -T\` keeps stdin attached and does not exit until EOF.
  cat > /dev/null
  # The probe's stderr: what Prisma writes when it throws, and what the script used to
  # send to /dev/null. Emitted before the exit so a failing probe can carry both.
  [ -z "\${FAKE_DB_STDERR:-}" ] || printf '%b\n' "\$FAKE_DB_STDERR" >&2
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

// Real curl writes %{http_code} and THEN exits non-zero for both a failed connection
// (code 000) and, under -f, an HTTP error (the real code) — the two cases that used to be
// concatenated with a second fallback value.
const FAKE_CURL = `#!/bin/sh
printf '%s' "\${FAKE_HTTP_CODE-200}"
exit "\${FAKE_CURL_EXIT:-0}"
`;

// A readable kernel log. FAKE_JOURNAL_BLIND=1 makes `journalctl -k` emit no kernel line
// and exit 0 — which is what BOTH blind cases look like on stdout, deliberately: a cron
// user outside the journal groups and a host with no recorded kernel entries are
// indistinguishable here. FAKE_ID_GROUPS helps choose advice without assuming a cause;
// journalctl's own hint is suppressed by the -q the script passes.
const FAKE_JOURNALCTL = `#!/bin/sh
if [ "\${FAKE_JOURNAL_EXIT:-0}" != "0" ]; then
  printf '%b' "\${FAKE_KERNEL_LOG:-}"
  exit "$FAKE_JOURNAL_EXIT"
fi
if [ "\${FAKE_JOURNAL_BLIND:-0}" = "1" ]; then
  exit 0
fi
printf '%b\n' "\${FAKE_KERNEL_LOG:-Aug 25 09:00:00 host kernel: Linux version 6.0.0}"
`;

// The discriminator between "unreadable" and "no-kernel-log". Defaults to a user with no
// journal access, so a test that does not opt in gets the branch carrying the actionable
// advice — the safe direction if the script's default ever regresses.
const FAKE_ID = `#!/bin/sh
if [ "\${1:-}" = "-u" ]; then
  printf '%s\n' "\${FAKE_ID_UID:-1000}"
  exit 0
fi
printf '%s\n' "\${FAKE_ID_GROUPS:-nogroup users}"
`;

const FAKE_DF = `#!/bin/sh
printf 'Use%%\n%s%%\n' "\${FAKE_DISK_PCT:-10}"
`;

const FAKE_MAIL = `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_STATE/mail.args"
printf '%s\n' '---MAIL---' >> "$FAKE_STATE/mail.log"
cat >> "$FAKE_STATE/mail.log"
[ -z "\${FAKE_MAIL_STDERR:-}" ] || printf '%b\n' "\$FAKE_MAIL_STDERR" >&2
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

const stateDir = (): string => join(projectDir, '.health-alert');
const stateFile = (name: string): string => join(stateDir(), name);

const readStateFile = (name: string): string => {
  try {
    return readFileSync(stateFile(name), 'utf8');
  } catch {
    return '';
  }
};

const writeStateFile = (name: string, contents: string): void => {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(stateFile(name), contents);
};

// The env pair that makes PROBLEMS non-empty, i.e. that gets a send attempted at all.
const FAILING_PROBE = { FAKE_LONG_Q: '1', FAKE_LONGEST: '130' };

const countAlerts = (log: string): number =>
  log.match(/SuperSync health check failed/g)?.length ?? 0;

// spawnSync hands the child an already-closed stdin, so a descriptor that never reaches
// EOF is the only way to reproduce what an interactive shell gives the script. A FIFO
// opened read-write keeps a writer around for as long as the fd is held.
const runWithOpenStdin = (env: Record<string, string> = {}): RunResult => {
  const fifo = join(projectDir, 'stdin.fifo');
  spawnSync('mkfifo', [fifo]);
  const fd = openSync(fifo, 'r+');
  try {
    return run(env, fd);
  } finally {
    closeSync(fd);
    rmSync(fifo, { force: true });
  }
};

const writeExecutable = (name: string, contents: string): void => {
  const path = join(binDir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

const run = (env: Record<string, string | undefined> = {}, stdin?: number): RunResult => {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    COMPOSE_DIR: projectDir,
    HEALTH_URL: 'https://health.test/health',
    ALERT_EMAIL: 'ops@example.test',
    FAKE_STATE: stateDir(),
    ...env,
  };

  for (const name of ['POSTGRES_SERVICE', 'MAX_QUERY_SECONDS', 'POOL_WARN_PCT']) {
    if (!(name in env)) {
      delete childEnv[name];
    }
  }
  const result = spawnSync('bash', [HEALTH_ALERT_SCRIPT], {
    encoding: 'utf8',
    env: childEnv,
    stdio: [stdin ?? 'pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  });

  // Without this a timeout or spawn failure surfaces as status 1 and fails an unrelated
  // assertion three lines later, hiding the fact that the script never ran to completion.
  if (result.error || result.signal) {
    throw new Error(
      `health-alert.sh did not complete: signal=${result.signal} error=${result.error}`,
    );
  }

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
  // The reporter calls this helper; extract it too, or the runner silently loses the
  // sanitizing and every assertion below passes against unfiltered marker text.
  const helper = deployScript.match(/sanitize_untrusted\(\) \{[\s\S]*?\n\}/);
  expect(helper).not.toBeNull();

  const runner = join(projectDir, 'report-monitoring-status.sh');
  // Same options deploy.sh sets at :16-17 — the `|| true` guards in the reporter are
  // load-bearing only under these, so a runner without them cannot catch their loss.
  writeFileSync(
    runner,
    `set -euo pipefail\nshopt -s inherit_errexit 2>/dev/null || true\n${helper?.[0] ?? ''}\n${match?.[0] ?? ''}\nreport_monitoring_status\n`,
  );
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
  writeExecutable('journalctl', FAKE_JOURNALCTL);
  writeExecutable('id', FAKE_ID);
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
    const result = spawnSync(process.execPath, ['--check', '-'], {
      input: embeddedProbe(),
      encoding: 'utf8',
    });
    expect(`${result.stdout}${result.stderr}`).toBe('');
    expect(result.status).toBe(0);
  });

  // Both shapes exit 1 with a complete, healthy sample already printed if the guard is
  // inside .finally rather than trailing it -- the 2026-08-24 flap on the hosted server.
  it.each([
    ['a rejecting', `$disconnect(){ return Promise.reject(new Error('closed')); }`],
    ['a synchronously throwing', `$disconnect(){ throw new Error('closed'); }`],
  ])('survives %s $disconnect after a complete sample', (_label, disconnect) => {
    const clientDir = join(projectDir, 'node_modules', '@prisma', 'client');
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(
      join(clientDir, 'index.js'),
      `const tx = {
         $executeRawUnsafe: async () => 0,
         $queryRawUnsafe: async () => [
           { longQueryCount: 0, longest: 0, poolInUse: 3, badIndex: '' },
         ],
       };
       exports.PrismaClient = class {
         $transaction(fn) { return fn(tx); }
         ${disconnect}
       };\n`,
    );

    // cwd is what makes the stub resolve: `node -e` builds its module paths from cwd, and
    // the package's REAL @prisma/client would win from anywhere else.
    const result = spawnSync(process.execPath, ['-e', embeddedProbe()], {
      cwd: projectDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://u:p@postgres:5432/supersync?connection_limit=60',
      },
    });

    expect(result.stdout).toContain('POOL_IN_USE=3');
    expect(result.stdout).toContain('BAD_INDEX=');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('checks the bundled postgres service by default', () => {
    const result = run();

    expect(result.dockerLog).toContain(
      'compose ps -a --format {{.State}}|{{.Health}}|{{.ExitCode}} postgres',
    );
  });

  it('honors an explicitly empty POSTGRES_SERVICE for an external database', () => {
    const result = run({ POSTGRES_SERVICE: '' });

    expect(result.dockerLog).not.toContain(
      'compose ps -a --format {{.State}}|{{.Health}}|{{.ExitCode}} postgres',
    );
  });

  it('honors POSTGRES_SERVICE= from .env', () => {
    writeFileSync(
      join(projectDir, '.env'),
      'DOMAIN=sync.example.test\nPOSTGRES_SERVICE=\n',
    );

    const result = run();

    expect(result.dockerLog).not.toContain(
      'compose ps -a --format {{.State}}|{{.Health}}|{{.ExitCode}} postgres',
    );
  });

  it('names the state of a stopped container instead of an empty one', () => {
    // The 2026-08-25 outage mailed "Container 'supersync' state:" with nothing after it:
    // `docker compose ps` without -a hides stopped containers, so the exited state that
    // named the root cause never reached the operator.
    const result = run({ FAKE_STOPPED_SVC: 'supersync' });

    expect(result.mailLog).toContain("Container 'supersync' state: exited (exit 128)");
    expect(result.mailLog).not.toMatch(/state:\s*$/m);
  });

  it('names the exit code, which {{.State}} alone does not carry', () => {
    // Real compose renders {{.State}} as a bare "exited". Reporting only that would have
    // mailed "state: exited" for the outage -- better than the empty string, but still
    // silent about the 128 (runc task-creation failure) that named the root cause.
    // 137 is the one an operator most needs told apart from it: OOM-killed.
    const result = run({ FAKE_STOPPED_SVC: 'supersync', FAKE_EXIT_CODE: '137' });

    expect(result.dockerLog).toContain('{{.ExitCode}}');
    expect(result.mailLog).toContain("Container 'supersync' state: exited (exit 137)");
  });

  it('does not report a healthy stack as missing on a compose without {{.ExitCode}}', () => {
    // A Go template naming one unsupported field aborts the whole render -- empty stdout,
    // which is byte-identical to "no such container". Without the retry every service on
    // a healthy self-hosted stack alerts as `missing`: a false-alarm storm shipped by the
    // change meant to make alerts trustworthy.
    const result = run({ FAKE_NO_EXITCODE_FIELD: '1' });

    expect(result.mailLog).not.toContain('missing');
    expect(result.dockerLog).toContain('--format {{.State}}|{{.Health}} supersync');
  });

  it('omits a zero exit code, which carries no information', () => {
    // A container that never started reports 0; "(exit 0)" next to a failure state is
    // noise that reads like a contradiction.
    const result = run({ FAKE_STOPPED_SVC: 'supersync', FAKE_EXIT_CODE: '0' });

    expect(result.mailLog).toContain("Container 'supersync' state: exited");
    expect(result.mailLog).not.toContain('exit 0');
  });

  it.each(['unhealthy', 'starting'])(
    'reports a running container whose health is %s',
    (health) => {
      const result = run({ FAKE_HEALTH: health });

      expect(result.mailLog).toContain(`Container 'supersync' health: ${health}`);
    },
  );

  it.each([
    ['no healthcheck at all, which renders as an empty field', ''],
    ['an older compose rendering the absent field as a sentinel', '<no value>'],
  ])('stays quiet for a running container with %s', (_label, health) => {
    // Both are "this service declares no healthcheck", not a fault. Splitting one line on
    // '|' made this reachable in a new way: before the split, an unparsed line could leak
    // the STATE into HEALTH and page `health: running` for a healthy stack.
    const result = run({ FAKE_HEALTH: health });

    expect(result.mailLog).not.toContain('health:');
    expect(result.mailLog).not.toContain('SuperSync health check failed');
  });

  it.each([
    ['a declared service with no container', '0'],
    ['a service compose does not know', '1'],
  ])('reports %s as missing (compose exit %s)', (_label, exitCode) => {
    const result = run({ FAKE_MISSING_SVC: 'caddy', FAKE_MISSING_EXIT: exitCode });

    expect(result.mailLog).toContain("Container 'caddy' state: missing");
    expect(result.mailLog).not.toMatch(/state:\s*$/m);
  });

  it('still reports the restart count of a container that is not running', () => {
    // Check 1 uses -a but check 3 used plain -q, so a dead container had no id here and
    // RestartCount — "died once" vs "crash-looped 40 times" — vanished exactly when the
    // operator needed it. Same class of bug as the empty state the 2026-08-25 mail carried.
    const result = run({ FAKE_STOPPED_SVC: 'supersync', FAKE_RESTART_COUNT: '42' });

    expect(result.dockerLog).toContain('compose ps -aq supersync');
    expect(result.mailLog).toContain("Container 'supersync' has restarted 42 times");
  });

  it('runs probes with Prisma inside the supersync container', () => {
    const result = run({ POSTGRES_SERVICE: '' });
    const script = readFileSync(HEALTH_ALERT_SCRIPT, 'utf8');

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

  it('completes the database probe when stdin never reaches EOF', () => {
    // `docker compose exec -T` does not exit until stdin closes, so without `</dev/null`
    // the $(...) capture outlives the probe, `timeout -k` SIGKILLs it, and every key goes
    // missing — turning a healthy server into "Database monitoring checks failed".
    const result = runWithOpenStdin();

    expect(result.status).toBe(0);
    expect(result.mailLog).not.toContain('Database monitoring checks failed');
  });

  it('names the probe exit status instead of one flat failure string', () => {
    // 137 is SIGKILL, the signature of `timeout -k` giving up. That is a different fault
    // from a probe that threw (1) or an exec that never started (127), and the message
    // used to be identical for all three.
    const result = run({ FAKE_DB_EXIT: '137' });

    expect(result.mailLog).toContain('Database monitoring checks failed (exit 137)');
  });

  it('treats malformed probe output as a database monitoring failure', () => {
    const result = run({ FAKE_DB_MALFORMED: '1' });

    expect(result.mailLog).toContain('Database monitoring checks failed');
  });

  it('carries the probe stderr into the alert body', () => {
    // Measured 2026-09: four "Database monitoring checks failed" mails, one of them exit 1
    // — the single mode where the probe DID catch a cause and print it — and `2>/dev/null`
    // discarded it. The status alone cannot distinguish a Prisma error from a docker exec
    // that never started, so the alert cost a full manual investigation to reach a
    // database that was healthy the whole time.
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_DB_STDERR: 'Database probe failed: Timed out fetching a new connection',
    });

    expect(result.mailLog).toContain('Database monitoring checks failed (exit 1)');
    expect(result.mailLog).toContain('Timed out fetching a new connection');
  });

  it('redacts a datasource URL from the probe stderr before mailing it', () => {
    // Prisma names the datasource in several connection errors, and this text is emailed.
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_DB_STDERR:
        'P1001: cannot reach postgresql://supersync:hunter2@db:5432/supersync?schema=public',
    });

    expect(result.mailLog).toContain('P1001: cannot reach');
    expect(result.mailLog).not.toContain('hunter2');
    expect(result.mailLog).not.toContain('db:5432');
  });

  it('keeps the probe stderr out of the dedupe key', () => {
    // The whole reason the status is normalized: a body that varies run to run must not
    // reopen the incident, or a Prisma error whose text shifts would mail every 5 minutes.
    run({ FAKE_DB_EXIT: '1', FAKE_DB_STDERR: 'first failure text' });
    const result = run({ FAKE_DB_EXIT: '1', FAKE_DB_STDERR: 'entirely different text' });

    expect(countAlerts(result.mailLog)).toBe(1);
  });

  it('redacts a malformed datasource URL through the end of its line', () => {
    // Actual Docker Compose interpolation error: the invalid URL includes a space in
    // the password, so treating whitespace as its end leaks the remaining credential.
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_DB_STDERR:
        'invalid interpolation format for services.supersync.environment.DATABASE_URL.\n' +
        'postgresql://demo:before SECRET_SUFFIX${BROKEN@db:5432/test\n' +
        'Check the Compose configuration.',
    });

    expect(result.mailLog).toContain('invalid interpolation format');
    expect(result.mailLog).toContain('<redacted-url>');
    expect(result.mailLog).not.toContain('SECRET_SUFFIX');
    expect(result.mailLog).not.toContain('db:5432');
    expect(result.mailLog).toContain('Check the Compose configuration.');
  });

  it('omits the probe stderr section on a healthy run', () => {
    // A probe that warns on stdout-clean success must not append noise to an unrelated
    // alert, so the capture is read only on the failing path.
    const result = run({ ...FAILING_PROBE, FAKE_DB_STDERR: 'a harmless warning' });

    expect(result.mailLog).toContain('SuperSync health check failed');
    expect(result.mailLog).not.toContain('Database probe stderr');
    expect(result.mailLog).not.toContain('a harmless warning');
  });

  it('leaves no probe stderr scratch file behind', () => {
    run({ FAKE_DB_EXIT: '1', FAKE_DB_STDERR: 'boom' });

    expect(existsSync(stateFile('.db-probe-err'))).toBe(false);
  });

  it.each(['0', '1', '124'])(
    'reports empty stderr without inventing a cause for probe exit %s',
    (exit) => {
      const result = run({ FAKE_DB_EXIT: exit, FAKE_DB_MALFORMED: '1' });

      expect(result.mailLog).toContain(
        `Database monitoring checks failed (exit ${exit})`,
      );
      expect(result.mailLog).toContain('(no stderr captured)');
      expect(result.mailLog).not.toContain('killed before it could report');
    },
  );

  it('redacts any URL scheme, not just the two Prisma spellings we expect', () => {
    // An allowlist of postgres:// and postgresql:// silently passes prisma:// (Accelerate,
    // whose api_key IS the credential) and any future scheme. Over-redacting an unrelated
    // URL costs one line of diagnostic text; under-redacting costs a credential.
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_DB_STDERR: 'P6008 prisma://accelerate.example.net/?api_key=SECRETKEY123',
    });

    expect(result.mailLog).toContain('P6008');
    expect(result.mailLog).not.toContain('SECRETKEY123');
  });

  it('strips control characters from the probe stderr too', () => {
    // strip_control_chars is shared with record_mail_failure precisely so the two cannot
    // drift; only the mail-failure caller was pinned, so this half was free to regress.
    const result = run({
      FAKE_DB_EXIT: '1',
      FAKE_DB_STDERR: 'before\\033[2J\\033[1;31mafter',
    });

    expect(result.mailLog).toContain('after');
    expect(result.mailLog).not.toMatch(/[ --]/);
  });

  it.each(['', 'not-a-number', '0'])(
    'alerts when the running DATABASE_URL connection_limit is %j',
    (poolLimit) => {
      // Two runs: an invalid limit skips the pool check entirely, so even a sustained
      // busy count must never surface a pool line -- only the config problem.
      run({ FAKE_POOL_IN_USE: '120', FAKE_POOL_LIMIT: poolLimit });
      const result = run({ FAKE_POOL_IN_USE: '120', FAKE_POOL_LIMIT: poolLimit });

      expect(result.mailLog).toContain('DATABASE_URL has no valid connection_limit');
      expect(result.mailLog).not.toContain('Connection pool');
      expect(result.mailLog).not.toContain('measured against max_connections');
      expect(result.dockerLog).not.toContain('max_connections');
    },
  );

  it('alerts when concurrently busy connections stay at the configured percentage', () => {
    const busy = {
      FAKE_POOL_IN_USE: '45',
      FAKE_POOL_LIMIT: '60',
      POOL_WARN_PCT: '75',
    };
    run(busy);
    const result = run(busy);

    // "busy", not "saturated": the probe counts only active / in-transaction sessions,
    // never the idle ones Prisma keeps pooled, so this is a concurrency number and an
    // operator told "saturated" goes looking for exhaustion that is not happening.
    expect(result.mailLog).toContain(
      'Connection pool 75% busy (45 of 60 running a query or in a transaction)',
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
    // Monitoring reports run under their own, longer statement_timeout, so they
    // routinely outlive MAX_QUERY_SECONDS. Without this the suite would page the
    // operator about its own tooling. Interpolated rather than copied so the
    // shell script and MONITORING_APPLICATION_NAME cannot drift apart silently.
    expect(result.dockerLog).toContain(
      `application_name <> '${MONITORING_APPLICATION_NAME}'`,
    );
    // ...but the suppression must reach only the pageable metrics. poolInUse is
    // a plain count(*), so a monitoring session still shows up as the real
    // backend it is -- the resource the 2026-07-20 pool exhaustion consumed.
    expect(result.dockerLog).toContain('WHERE pageable AND active_age >');
    expect(result.dockerLog).toContain('max(active_age) FILTER (WHERE pageable)');
    expect(result.dockerLog).toContain('count(*)::integer AS "poolInUse"');
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

  it('exempts the nightly backup from the long-query check, but not from pool-busy', () => {
    // A full pg_dump legitimately runs for hours (measured: ~112 min on the hosted
    // server), so without this it pages on a timetable every single night, which is
    // how an alert channel gets ignored. Both ends are asserted against the same
    // literal: the exemption is worthless if they drift, and the drift is silent
    // in both directions.
    const backupScript = readFileSync(BACKUP_SCRIPT, 'utf8');
    expect(backupScript).toContain(
      `BACKUP_APPLICATION_NAME="${BACKUP_APPLICATION_NAME}"`,
    );
    // Set on the dump's own session, not the wrapper -- pg_dump runs inside the
    // postgres container, so the env has to cross `docker exec`.
    // One helper, so a new dump site cannot forget the stamp.
    expect(backupScript).toContain('docker exec -e PGAPPNAME="$BACKUP_APPLICATION_NAME"');

    const result = run();

    expect(result.dockerLog).toContain(`application_name = '${BACKUP_APPLICATION_NAME}'`);
    // Capped, not hidden: a dump still running after 6h is a wedge, and pages again.
    expect(result.dockerLog).toContain("interval '6 hours'");
    // The exemption rides the `pageable` flag, so the dump is still counted as the
    // real backend it is: a dump that genuinely starves the pool still alerts.
    expect(result.dockerLog).toContain('count(*)::integer AS "poolInUse"');
    expect(result.dockerLog).toContain('WHERE pageable AND active_age >');
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

describe('health-alert.sh postgres crash-restart check', () => {
  // An in-place crash recovery never touches container state, RestartCount, or the
  // compose healthcheck (recovery finishes in seconds; the probe needs 5 consecutive
  // failures), so checks 1 and 3 are structurally blind to it — 45 occurrences on the
  // hosted server before one was noticed (#9695). The postmaster's own log line is the
  // only durable trace, and the postgres log window rotates within days.
  const CRASH_LINE =
    '2026-08-22 08:05:22.841 UTC [1] LOG:  all server processes terminated; reinitializing';

  it('pages when the postmaster reinitialized inside a running container', () => {
    const result = run({ FAKE_PG_LOG: CRASH_LINE });

    // --since is load-bearing: unbounded `docker logs` re-reads the whole retained
    // window every 5 minutes and would re-page old crashes after every incident.
    expect(result.dockerLog).toContain('logs --since 6m id-postgres');
    expect(result.mailLog).toContain(
      'PostgreSQL crash-restarted in place (1 entries in last 6 min)',
    );
  });

  it('does not re-mail when the crash count changes', () => {
    // Pins the message wording to the existing "(N entries" normalizer rule: a crash
    // sitting in the one-minute overlap of two consecutive 6-min windows is counted by
    // both runs, and the second sighting must dedupe, not re-page.
    run({ FAKE_PG_LOG: CRASH_LINE });
    const second = run({ FAKE_PG_LOG: `${CRASH_LINE}\\n${CRASH_LINE}` });

    expect(countAlerts(second.mailLog)).toBe(1);
    expect(second.mailLog).toContain('(1 entries in last 6 min)');
  });

  it('stays quiet on a normal postgres log', () => {
    const result = run({
      FAKE_PG_LOG: '2026-08-22 08:04:16 UTC [27737] LOG:  checkpoint starting: time',
    });

    expect(result.mailLog).toBe('');
  });

  it('skips the container log read for an external database', () => {
    const result = run({ POSTGRES_SERVICE: '', FAKE_PG_LOG: CRASH_LINE });

    expect(result.dockerLog).not.toContain('logs --since');
    expect(result.mailLog).toBe('');
  });
});

describe('health-alert.sh health endpoint reporting', () => {
  // curl writes the status code itself and exits non-zero on both faults, so a trailing
  // `|| echo 000` appended a SECOND code: the 2026-08-25 alert read "HTTP 000000", and an
  // HTTP error would have read "HTTP 502000".
  it.each([
    ['a failed connection', '000', '7', '000'],
    ['an HTTP error status', '502', '22', '502'],
    ['curl producing no output at all', '', '2', '000'],
  ])('reports exactly one status code for %s', (_label, code, curlExit, expected) => {
    const result = run({ FAKE_HTTP_CODE: code, FAKE_CURL_EXIT: curlExit });

    expect(result.mailLog).toContain(
      `Health endpoint returned HTTP ${expected} (https://health.test/health)`,
    );
    expect(result.mailLog).toMatch(/Health endpoint returned HTTP [0-9]{3} \(/);
  });
});

describe('health-alert.sh kernel log OOM check', () => {
  it('records a blind kernel log in the marker, never in the alert body', () => {
    // Outside 'adm' / 'systemd-journal', journalctl -k prints a hint on stderr and exits
    // 0 with no kernel lines, so the check silently counted 0 hits forever. Surfacing that
    // is right; surfacing it through PROBLEMS is not — see the recovery test below.
    const result = run({ FAKE_JOURNAL_BLIND: '1' });

    expect(existsSync(stateFile('oom-check-blind'))).toBe(true);
    expect(result.output).toContain('OOM detection is blind');
    expect(result.mailLog).not.toContain('OOM kill detected');
  });

  it('still sends the recovery mail on a host whose kernel log is unreadable', () => {
    // The regression that made the marker necessary: an unreadable kernel log is permanent
    // on any host where the cron user simply is not in 'adm' — and on every non-systemd
    // host, where the advice is not even applicable. Routing it into PROBLEMS would leave
    // PROBLEMS non-empty forever, and `[ -n "$PROBLEMS" ]` gates the recovery branch, so
    // "Health Check Recovered" could never be sent again on those hosts.
    run({ ...FAILING_PROBE, FAKE_JOURNAL_BLIND: '1' });
    expect(readStateFile('mail.log')).toContain('SuperSync health check failed');

    run({ FAKE_JOURNAL_BLIND: '1' });
    const result = run({ FAKE_JOURNAL_BLIND: '1' });

    expect(result.mailLog).toContain('SuperSync health check recovered');
    expect(existsSync(stateFile('state'))).toBe(false);
  });

  it('warns on stderr only on the transition into blindness, not every run', () => {
    // cron mails every line a job writes. The condition is permanent on any host missing the
    // group, so an unconditional warning would be 288 mails/day into the same inbox as the
    // real alerts. The marker carries the standing state for deploy.sh instead.
    const first = run({ FAKE_JOURNAL_BLIND: '1' });
    expect(first.output).toContain('OOM detection is blind');

    const second = run({ FAKE_JOURNAL_BLIND: '1' });

    expect(second.output).not.toContain('OOM detection is blind');
    expect(existsSync(stateFile('oom-check-blind'))).toBe(true);
  });

  it('distinguishes an absent journalctl from an unreadable one', () => {
    // Alpine and any other non-systemd host: Dockerfile:60 ships scripts/ to self-hosters,
    // and there the OOM check is not applicable rather than misconfigured. Telling those
    // operators to join a group that does not exist would be permanent, unfixable noise.
    // JOURNAL_CMD mirrors the MAIL_CMD seam the script already documents. Deleting the
    // fake off PATH would not do it: `command -v` still finds the host's real journalctl,
    // so the test would be green only on a non-systemd machine.
    const result = run({ JOURNAL_CMD: 'journalctl-not-installed' });

    expect(result.output).toContain('no journalctl on this host');
    expect(result.output).not.toContain("group 'systemd-journal'");
    expect(readStateFile('oom-check-blind')).toContain('no-journalctl');
  });

  it('does not read a hint that the -q it passes suppresses', () => {
    // journalctl(1) on -q: "Suppresses all informational messages ..., any warning messages
    // regarding inaccessible system journals when run as a normal user" — i.e. the exact
    // "you are currently not seeing messages" hint. An earlier cut of this fix grepped for
    // it, so `unreadable` was unreachable and EVERY permission-blind host was told its
    // problem was unfixable. Verified against systemd 255. The discriminator must be
    // something -q cannot erase, so no journalctl stderr may appear in the decision.
    const script = readFileSync(HEALTH_ALERT_SCRIPT, 'utf8');

    expect(script).not.toContain('not seeing messages');
  });

  it.each([
    ['adm', 'nogroup adm users'],
    ['systemd-journal', 'nogroup systemd-journal'],
    ['wheel', 'wheel users'],
  ])('does not blame permissions when the user is already in %s', (_group, groups) => {
    // Empty output can reflect host restrictions or journal configuration. Group
    // membership alone cannot establish the cause, so keep the diagnosis neutral.
    const result = run({ FAKE_JOURNAL_BLIND: '1', FAKE_ID_GROUPS: groups });

    expect(result.output).toContain('no kernel log entries are available');
    expect(result.output).not.toContain('not a misconfiguration');
    expect(result.output).not.toContain("group 'systemd-journal'");
    expect(readStateFile('oom-check-blind')).toContain('no-kernel-log');
  });

  it('does not blame permissions when running as root', () => {
    // root is in none of those groups and reads the journal regardless, so a group-only
    // check would send the one user who cannot have a permission problem after one.
    const result = run({
      FAKE_JOURNAL_BLIND: '1',
      FAKE_ID_UID: '0',
      FAKE_ID_GROUPS: 'root',
    });

    expect(result.output).toContain('no kernel log entries are available');
    expect(result.output).not.toContain('not a misconfiguration');
    expect(readStateFile('oom-check-blind')).toContain('no-kernel-log');
  });

  it.each([
    'admin adminx journal',
    'users systemd-journal-remote',
    'users adm-readonly',
    'users wheel-backup',
  ])('keeps the actionable advice for a user in unrelated groups: %s', (groups) => {
    // The direction that matters: this is the only branch the operator can act on, and the
    // -q defect made it unreachable. A near-miss group name must not count as access.
    const result = run({
      FAKE_JOURNAL_BLIND: '1',
      FAKE_ID_GROUPS: groups,
    });

    expect(result.output).toContain('OOM detection is blind');
    expect(result.output).toContain("group 'systemd-journal'");
    expect(readStateFile('oom-check-blind')).toContain('unreadable');
  });

  it.each([
    ['1', ''],
    ['124', ''],
    ['1', 'kernel: Linux version 6.0.0'],
  ])('reports journal exit %s as a failed read, even with output %j', (exit, output) => {
    const result = run({
      FAKE_ID_UID: '0',
      FAKE_JOURNAL_EXIT: exit,
      FAKE_KERNEL_LOG: output,
    });

    expect(result.output).toContain('failed to read the kernel log');
    expect(result.output).not.toContain('not a misconfiguration');
    expect(readStateFile('oom-check-blind')).toContain('journal-error');
  });

  it('tells the operator in the alert body that OOM coverage was missing', () => {
    // A mail listing problems while a check silently did not run overstates what was
    // verified. The note rides in the body only — never in PROBLEMS, which would make it
    // permanent there and kill the recovery branch.
    const result = run({ ...FAILING_PROBE, FAKE_JOURNAL_BLIND: '1' });

    expect(result.mailLog).toContain('the OOM check did not run');
  });

  it('omits the coverage note when the OOM check did run', () => {
    const result = run(FAILING_PROBE);

    expect(result.mailLog).toContain('SuperSync health check failed');
    expect(result.mailLog).not.toContain('the OOM check did not run');
  });

  it('still checks the kernel log when the Docker daemon is down', () => {
    // An OOM on a small host is exactly when dockerd is least likely to answer, so gating
    // this check on Docker skipped it in its own scenario -- and left the alert that
    // skipped the most checks disclosing the least.
    const result = run({
      FAKE_DOCKER_INFO_EXIT: '1',
      FAKE_KERNEL_LOG: 'kernel: Out of memory: Killed process 1',
    });

    expect(result.mailLog).toContain('Docker daemon');
    expect(result.mailLog).toContain('OOM kill detected in kernel log');
  });

  it('rewrites the marker when the reason changes, keeping the original onset', () => {
    // no-journalctl and unreadable get opposite advice from deploy.sh. Writing only on the
    // first blind run would pin the wrong one forever -- withholding the actionable
    // usermod hint on a host that has since grown a journal it still cannot read.
    writeStateFile('oom-check-blind', '2020-01-01T00:00:00Z\nno-journalctl\n');

    const result = run({ FAKE_JOURNAL_BLIND: '1' });
    const marker = readStateFile('oom-check-blind');

    expect(marker).toContain('unreadable');
    expect(marker).toContain('2020-01-01T00:00:00Z');
    expect(result.output).toContain("group 'systemd-journal'");
  });

  it('clears the marker once the kernel log becomes readable', () => {
    run({ FAKE_JOURNAL_BLIND: '1' });
    expect(existsSync(stateFile('oom-check-blind'))).toBe(true);

    run();

    expect(existsSync(stateFile('oom-check-blind'))).toBe(false);
  });

  it('stays quiet when the kernel log is readable and holds no OOM lines', () => {
    const result = run(FAILING_PROBE);

    expect(result.mailLog).toContain('SuperSync health check failed');
    expect(existsSync(stateFile('oom-check-blind'))).toBe(false);
  });

  it('still reports OOM kills found in a readable kernel log', () => {
    const result = run({
      FAKE_KERNEL_LOG: 'Aug 25 09:05:00 host kernel: oom-kill:constraint=CONSTRAINT_NONE',
    });

    expect(result.mailLog).toContain('OOM kill detected in kernel log (1 entries');
    expect(result.mailLog).not.toContain('OOM check unavailable');
  });
});

describe('health-alert.sh alert damping', () => {
  it('treats a changed probe exit status as the same problem', () => {
    // The 2026-08-25 storm: one long query made the probe time out, and the status it
    // died with alternated (124 timeout, 143 SIGTERM, 128 exec failure). The code stays
    // in the mail because it names the fault, but it must not reopen the alert.
    const first = run({ FAKE_DB_EXIT: '124' });
    const second = run({ FAKE_DB_EXIT: '143' });

    expect(first.mailLog).toContain('Database monitoring checks failed (exit 124)');
    expect(countAlerts(second.mailLog)).toBe(1);
  });

  it('does not re-alert a problem already mailed in this incident', () => {
    // Flapping between two symptoms of one incident. The single-hash state file used to
    // be overwritten on every flip, so each flip back looked new and mailed again.
    run(FAILING_PROBE);
    run({ FAKE_DB_EXIT: '124' });
    const flipBack = run(FAILING_PROBE);
    const flipAgain = run({ FAKE_DB_EXIT: '124' });

    expect(countAlerts(flipBack.mailLog)).toBe(2);
    expect(countAlerts(flipAgain.mailLog)).toBe(2);
  });

  it('keeps reporting a symptom that returns while another problem never clears', () => {
    // The set state file is cleared only by a recovery mail, and recovery needs PROBLEMS
    // entirely empty — so one never-clearing check (disk stuck above the threshold) would
    // otherwise hold the incident open forever and permanently mute every symptom already
    // mailed inside it. Verified against the pre-fix script: the third run sent nothing.
    const stuck = { FAKE_DISK_PCT: '90' };
    run({ ...stuck, ...FAILING_PROBE });
    const cleared = run(stuck);
    const returned = run({ ...stuck, ...FAILING_PROBE });

    expect(countAlerts(cleared.mailLog)).toBe(1);
    expect(countAlerts(returned.mailLog)).toBe(1);

    // ...but it does re-report once the incident ages out.
    const old = Date.now() / 1000 - 2 * 24 * 3600;
    utimesSync(stateFile('state'), old, old);
    const later = run({ ...stuck, ...FAILING_PROBE });

    expect(countAlerts(later.mailLog)).toBe(2);
  });

  it('does not re-mail a subset of an already-reported problem set', () => {
    // Hashing the whole set keys on its POWER set: "A", "A+B" and "B" would be three
    // independent entries, so a flapping incident across k symptoms costs up to 2^k-1
    // mails -- the same storm class, one level up. Keyed per line it is k.
    const both = { FAKE_DISK_PCT: '90', ...FAILING_PROBE };
    run(both);
    const subset = run({ FAKE_DISK_PCT: '90' });

    expect(countAlerts(subset.mailLog)).toBe(1);
  });

  it('normalizes a rotating container exit code, not just the probe one', () => {
    // Both emitters carry a code that rotates under load; only the probe's was normalized,
    // so a crash-looping container alternating 137 (OOM) / 143 (SIGTERM) mailed each flip.
    run({ FAKE_STOPPED_SVC: 'supersync', FAKE_EXIT_CODE: '137' });
    const other = run({ FAKE_STOPPED_SVC: 'supersync', FAKE_EXIT_CODE: '143' });

    expect(countAlerts(other.mailLog)).toBe(1);
  });

  it('starts a fresh incident after recovery', () => {
    run(FAILING_PROBE);
    run();
    run();
    const returned = run(FAILING_PROBE);

    expect(countAlerts(returned.mailLog)).toBe(2);
    expect(returned.mailLog).toContain('All checks passing.');
  });

  it('waits for consecutive healthy runs before declaring recovery', () => {
    run(FAILING_PROBE);
    const firstClean = run();
    expect(firstClean.mailLog).not.toContain('All checks passing.');

    const secondClean = run();
    expect(secondClean.mailLog).toContain('All checks passing.');
  });

  it('restarts the healthy-run count when the problem comes back', () => {
    run(FAILING_PROBE);
    run();
    run(FAILING_PROBE);
    const clean = run();

    expect(clean.mailLog).not.toContain('All checks passing.');
  });
});

describe('health-alert.sh pool-busy persistence gate', () => {
  // Pool-busy is the one check that reads an instantaneous gauge, so a single crossing
  // is routinely a stampede that self-heals within one interval. The morning of
  // 2026-08-27 was three fail+recovery pairs for exactly that: hourly-aligned client
  // sync at 04:00Z/06:00Z and the reconnect herd after a deploy restart at 07:00Z,
  // each gone by the next run. It pages only when the pressure survives to the next run.
  it('stays quiet on a pool spike seen in a single run, recovery included', () => {
    const spike = run({ FAKE_POOL_IN_USE: '45' });
    expect(spike.mailLog).toBe('');

    // Nothing was mailed, so the following clean runs owe no recovery either.
    run();
    const clean = run();
    expect(clean.mailLog).toBe('');
  });

  it('pages a pool condition that survives to the next run, with current numbers', () => {
    run({ FAKE_POOL_IN_USE: '45' });
    const second = run({ FAKE_POOL_IN_USE: '60' });

    expect(second.mailLog).toContain(
      'Connection pool 100% busy (60 of 60 running a query or in a transaction)',
    );
  });

  it('resets the pending marker on a pool-healthy run', () => {
    run({ FAKE_POOL_IN_USE: '45' });
    run();
    const again = run({ FAKE_POOL_IN_USE: '45' });

    expect(again.mailLog).toBe('');
  });

  it('still confirms across a realistically late second run', () => {
    // The FLOOR of the freshness window, which the back-to-back runs everywhere else in
    // this file cannot exercise: at the real 5-minute cadence the marker is ~5-7 minutes
    // old at the confirming run (cron jitter included). A window tighter than that would
    // silently un-page pool-busy forever — mutation-tested: with the window at
    // `-mmin -1`, every other test in this file still passes.
    run({ FAKE_POOL_IN_USE: '45' });
    const old = Date.now() / 1000 - 7 * 60;
    utimesSync(stateFile('pool-busy-pending'), old, old);
    const second = run({ FAKE_POOL_IN_USE: '45' });

    expect(second.mailLog).toContain('Connection pool 75% busy (45 of 60');
  });

  it('does not weld two spikes separated by a monitoring gap into one condition', () => {
    // A crashed or lock-skipped stretch of runs must not make two unrelated spikes 20
    // minutes apart look consecutive; the marker ages out after three intervals.
    run({ FAKE_POOL_IN_USE: '45' });
    const old = Date.now() / 1000 - 20 * 60;
    utimesSync(stateFile('pool-busy-pending'), old, old);
    const later = run({ FAKE_POOL_IN_USE: '45' });
    expect(later.mailLog).toBe('');

    // ...but the stale spike re-arms the marker, so the NEXT run still confirms.
    const confirmed = run({ FAKE_POOL_IN_USE: '45' });
    expect(confirmed.mailLog).toContain('Connection pool 75% busy (45 of 60');
  });
});

describe('health-alert.sh state handling', () => {
  it('deduplicates volatile long-query counts and durations', () => {
    run(FAILING_PROBE);
    const second = run({ FAKE_LONG_Q: '27', FAKE_LONGEST: '240' });

    expect(second.mailLog.match(/SuperSync health check failed/g)).toHaveLength(1);
    expect(second.mailLog).toContain('longest: 130s');
  });

  it('deduplicates volatile busy-connection counts', () => {
    // Pins the HASH_INPUT sed rule to the message wording: drift is silent, and its only
    // symptom is the alert re-mailing every five minutes. First run only arms the
    // persistence gate; the second mails; the third, with a different count, must not.
    run({ FAKE_POOL_IN_USE: '45' });
    run({ FAKE_POOL_IN_USE: '45' });
    const third = run({ FAKE_POOL_IN_USE: '52' });

    expect(third.mailLog.match(/SuperSync health check failed/g)).toHaveLength(1);
    expect(third.mailLog).toContain('75% busy (45 of 60');
  });

  it('sends recovery after mail failure and clears the sticky marker', () => {
    const failed = run({
      ...FAILING_PROBE,
      FAKE_MAIL_EXIT: '1',
    });
    expect(failed.output).toContain('Failed to send alert email');
    expect(existsSync(stateFile('mail-failed'))).toBe(true);

    run();
    const recovered = run();
    expect(recovered.mailLog).toContain('All checks passing.');
    expect(existsSync(stateFile('mail-failed'))).toBe(false);
  });

  it('retries failed delivery when an earlier problem remains active', () => {
    run({ FAKE_BAD_INDEX: 'index-a' });
    run({
      FAKE_BAD_INDEX: 'index-a',
      ...FAILING_PROBE,
      FAKE_MAIL_EXIT: '1',
    });
    expect(existsSync(stateFile('mail-failed'))).toBe(true);

    const retried = run({ FAKE_BAD_INDEX: 'index-a' });
    expect(retried.mailLog.match(/SuperSync health check failed/g)).toHaveLength(3);
    expect(existsSync(stateFile('mail-failed'))).toBe(false);

    const deduplicated = run({ FAKE_BAD_INDEX: 'index-a' });
    expect(deduplicated.mailLog.match(/SuperSync health check failed/g)).toHaveLength(3);
  });

  it('records a missing mail binary without waiting for an incident', () => {
    const result = run({ MAIL_CMD: 'supersync-mail-not-installed' });

    expect(result.output).toContain("no 'supersync-mail-not-installed' binary on PATH");
    expect(readStateFile('mail-failed')).toContain(
      'no supersync-mail-not-installed binary on PATH',
    );
    // The whole point is that a monitoring script never aborts: the checks still ran.
    expect(result.dockerLog).toContain('info');
    expect(readStateFile('last-run')).not.toBe('');
    // One line per run, not three: the doomed send must not be attempted as well.
    expect(result.output).not.toContain('Failed to send');
    expect(result.mailLog).toBe('');
  });

  it('captures why a real send failed, at both send sites', () => {
    const failed = run({
      ...FAILING_PROBE,
      FAKE_MAIL_EXIT: '1',
      FAKE_MAIL_STDERR: 'smtp: 550 relay access denied',
    });
    expect(failed.output).toContain('Failed to send alert email');
    const alertMarker = readStateFile('mail-failed');
    expect(alertMarker.split('\n')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(alertMarker).toContain('550 relay access denied');

    // Second healthy run: recovery needs two consecutive clean runs.
    run({ FAKE_MAIL_EXIT: '1', FAKE_MAIL_STDERR: 'smtp: 535 authentication failed' });
    const recovery = run({
      FAKE_MAIL_EXIT: '1',
      FAKE_MAIL_STDERR: 'smtp: 535 authentication failed',
    });
    expect(recovery.output).toContain('Failed to send recovery email');
    const recoveryMarker = readStateFile('mail-failed');
    expect(recoveryMarker.split('\n')[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect(recoveryMarker).toContain('535 authentication failed');
  });

  it('strips control characters and bounds relay-supplied failure text', () => {
    const marker = run({
      ...FAILING_PROBE,
      FAKE_MAIL_EXIT: '1',
      FAKE_MAIL_STDERR: `relay\u0007said\u001b[31mred\rCARRIAGE\u007f${'x'.repeat(9000)}`,
    });
    expect(marker.output).toContain('Failed to send alert email');
    const text = readStateFile('mail-failed');
    // Only ESC/BEL are control characters here; the printable "[31m" correctly survives.
    expect(text).toContain('relaysaid[31mred');
    expect(text).not.toMatch(/[\u0007\u001b\r\u007f]/);
    expect(text.length).toBeLessThanOrEqual(4200);
  });

  it('strips UTF-8-encoded C1 controls without corrupting other UTF-8', () => {
    // \\302\\233 is the well-formed UTF-8 encoding of U+009B (CSI). Both bytes are >= 0x80,
    // so a plain C0 byte filter passes them through and the terminal decodes a real
    // control. Stripping the byte RANGE 0x80-0x9F instead would corrupt every non-ASCII
    // string, so the em-dash and CJK below must survive untouched.
    const marker = run({
      ...FAILING_PROBE,
      FAKE_MAIL_EXIT: '1',
      FAKE_MAIL_STDERR:
        'relay \\302\\2331;31mRED said \\342\\200\\224 dash \\346\\227\\245',
    });
    expect(marker.output).toContain('Failed to send alert email');
    const text = readStateFile('mail-failed');
    expect(text).toContain('relay 1;31mRED said — dash 日');
    expect(text).not.toContain('\u009b');
  });

  it('does not hang when the mail command forks a child that outlives it', () => {
    // `err=$(...)` waits for pipe EOF, not for the process, so a forked delivery child
    // keeps the run alive past `timeout 30` while it holds the flock — which silently
    // kills every later cron run. A queuing MTA daemonizes exactly like this.
    writeExecutable(
      'mail',
      `#!/bin/sh\nsh -c 'sleep 30' &\nprintf '%s\\n' 'smtp: 451 try again' >&2\nexit 1\n`,
    );
    const started = Date.now();
    const result = run(FAILING_PROBE);
    const elapsedMs = Date.now() - started;

    expect(result.output).toContain('Failed to send alert email');
    expect(readStateFile('mail-failed')).toContain('451 try again');
    // The forked child sleeps 30s; anything near that means the run blocked on it.
    expect(elapsedMs).toBeLessThan(15_000);
  });

  it('reports heartbeat and mail failure even without a current-user cron entry', () => {
    writeStateFile('last-run', new Date().toISOString());
    writeStateFile('mail-failed', '2026-07-20T12:00:00Z\nno mail binary on PATH\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain("not in this user's crontab");
    expect(output).toContain('recent completed run');
    // head -1, not $(cat …): a multi-line marker must not interpolate mid-sentence.
    expect(output).toContain('alert email delivery FAILED at 2026-07-20T12:00:00Z.');
    expect(output).toContain('Reason: no mail binary on PATH');
    expect(output).not.toContain('will go unnoticed');
  });

  it('gives actionable advice when the kernel log is unreadable', () => {
    // The marker's whole justification is that it reaches the operator through deploy.sh
    // instead of through PROBLEMS. Untested, that hand-off is an assumption.
    writeStateFile('oom-check-blind', '2026-08-25T03:05:00Z\nunreadable\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain('OOM detection is BLIND');
    expect(output).toContain('since 2026-08-25T03:05:00Z');
    expect(output).toContain('usermod -aG systemd-journal');
  });

  it('reports missing kernel entries without assuming a container limitation', () => {
    writeStateFile('oom-check-blind', '2026-09-10T03:05:00Z\nno-kernel-log\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain('no kernel log entries are available');
    expect(output).toContain('journal configuration');
    expect(output).toContain('since 2026-09-10T03:05:00Z');
    expect(output).not.toContain('usermod');
    expect(output).not.toContain('OOM detection is BLIND');
    expect(output).not.toContain('not a misconfiguration');
  });

  it('reports failed journal reads as a capability that needs investigation', () => {
    writeStateFile('oom-check-blind', '2026-09-10T03:05:00Z\njournal-error\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain('OOM detection is BLIND');
    expect(output).toContain('journal read failed');
    expect(output).toContain('journalctl -k');
    expect(output).not.toContain('usermod');
    expect(output).not.toContain('not a misconfiguration');
  });

  it('does not tell a non-systemd host to join a group that cannot exist', () => {
    // Dockerfile:60 ships scripts/ to self-hosters, Alpine among them. A permanent
    // WARNING with unfollowable remediation on every deploy is how an operator learns to
    // skim past the block that also carries "alert email delivery FAILED".
    writeStateFile('oom-check-blind', '2026-08-25T03:05:00Z\nno-journalctl\n');

    const output = runDeployMonitoringStatus();

    expect(output).toContain('no journalctl on this host');
    expect(output).not.toContain('usermod');
    expect(output).not.toContain('OOM detection is BLIND');
  });

  it('sanitizes a hostile oom-check-blind marker it did not write', () => {
    // Same trust boundary as mail-failed: deploy.sh may read a marker it did not write.
    writeStateFile(
      'oom-check-blind',
      '2026-08-25T03:05:00Z\u001b[2J\u001b[1;31mFAKE\nunreadable\u009b2K\u0007\n',
    );

    const output = runDeployMonitoringStatus();

    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\u009b]/);
  });

  it('sanitizes a hostile marker it did not write', () => {
    // deploy.sh may run as a user who can read .health-alert but did not write it, so
    // the reader cannot assume the write-time filter ran. \u001b[2J clears the operator's
    // screen and \u009b is a decoded C1 CSI; neither may reach the terminal.
    // last-run lives in the same directory and is printed by the same function, so it
    // is exactly as untrusted as mail-failed.
    writeStateFile('last-run', `${new Date().toISOString()}\u001b[1;31m OWNED\u0007`);
    writeStateFile(
      'mail-failed',
      '2026-07-20T12:00:00Z\u001b[2J\u001b[1;31mFAKE\n550 \u009b2Kdenied\u0007 here\n',
    );

    const output = runDeployMonitoringStatus();

    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\u009b]/);
    expect(output).toContain('550 2Kdenied here');
    expect(output).toContain('[1;31m OWNED');
  });
});

/**
 * REPLAY OF THE NIGHT OF 2026-08-25/26 on the production VPS — the incident that motivated the
 * dedupe rewrite. The operator received 16 mails (13 alerts + 3 recoveries) between
 * 23:05 and 07:45 UTC and asked how to stop it happening every night.
 *
 * THE TIMELINE IS NOT RECONSTRUCTED FROM MEMORY. Every mail below is one the operator
 * actually received, quoted from its subject line. The state on the RUNS THAT SENT NO
 * MAIL is then FORCED, not guessed, because the shipped script's rule was "mail iff the
 * normalized problem-set hash differs from the stored one":
 *
 *   - a silent run cannot have been healthy (that would have sent a recovery, and the
 *     shipped script sent one on the FIRST clean run), so it was still failing;
 *   - and it must have hashed identically to the previous mail, or it would have mailed.
 *
 * That pins 23:40 to the same `exit 124` as 23:35, the 00:15–00:45 stretch to the same
 * long query as 00:10, and 07:05–07:40 to the same pool-busy as 07:00. The 01:00–05:55
 * stretch is quiet by the same argument (state was cleared by the 00:55 recovery, and
 * nothing mailed for five hours); it is replayed at reduced cadence because after the
 * second clean run those runs are behaviourally identical, and 60 more spawns buy
 * nothing.
 *
 * THE DUMP'S OWN SESSION. The four long-query alerts between 23:05 and 00:45 report
 * durations of 295s / 2740s / 4201s against a `pg_dump` that started at 23:00:12 and ran
 * ~112 minutes — they ARE the dump, matched to the second. They are replayed as absent
 * because the probe now excludes `application_name = 'supersync-backup'` at the SQL
 * level, which is not something these shell fakes can evaluate; that exclusion has its
 * own real-PostgreSQL coverage in health-alert-db-probe.integration.spec.ts. The 07:45
 * long query is NOT the dump (it ended ~00:52) and must still be reported.
 *
 * MEASURED: the shipped script replays this timeline at 16 mails (13 alerts, 3
 * recoveries); the current one at 8 (5 alerts, 3 recoveries). The point of the test is
 * not the number — it is that the number cannot regress without someone noticing, and
 * that every DISTINCT problem still reaches the operator, including one that recurs
 * after its incident already recovered.
 */
/** `// MAILED` marks a run the SHIPPED script sent a mail on — i.e. a real observation. */
type Run =
  | { at: string; state: 'ok' }
  | { at: string; state: 'probe'; exit: string }
  | { at: string; state: 'longQuery'; seconds: string; isBackupSession: boolean }
  | { at: string; state: 'poolBusy'; inUse: string };

const NIGHT_OF_2026_08_25: Run[] = [
  // The dump starts 23:00:12. Every long query below until 00:45 is its own session.
  { at: '23:05', state: 'longQuery', seconds: '295', isBackupSession: true }, // MAILED
  { at: '23:10', state: 'longQuery', seconds: '600', isBackupSession: true },
  { at: '23:15', state: 'longQuery', seconds: '900', isBackupSession: true },
  { at: '23:20', state: 'longQuery', seconds: '1200', isBackupSession: true },
  { at: '23:25', state: 'longQuery', seconds: '1500', isBackupSession: true },
  { at: '23:30', state: 'longQuery', seconds: '1800', isBackupSession: true },
  // Under the dump's load the probe itself starts dying, with a rotating exit status:
  // 124 (outer `timeout`), 143 (128+SIGTERM on the inner one), 128 (exec failure).
  { at: '23:35', state: 'probe', exit: '124' }, // MAILED
  { at: '23:40', state: 'probe', exit: '124' },
  { at: '23:45', state: 'longQuery', seconds: '2740', isBackupSession: true }, // MAILED
  { at: '23:50', state: 'probe', exit: '143' }, // MAILED
  { at: '23:55', state: 'probe', exit: '124' }, // MAILED
  { at: '00:00', state: 'probe', exit: '128' }, // MAILED
  { at: '00:05', state: 'probe', exit: '143' }, // MAILED
  { at: '00:10', state: 'longQuery', seconds: '4201', isBackupSession: true }, // MAILED
  { at: '00:15', state: 'longQuery', seconds: '4500', isBackupSession: true },
  { at: '00:20', state: 'longQuery', seconds: '4800', isBackupSession: true },
  { at: '00:25', state: 'longQuery', seconds: '5100', isBackupSession: true },
  { at: '00:30', state: 'longQuery', seconds: '5400', isBackupSession: true },
  { at: '00:35', state: 'longQuery', seconds: '5700', isBackupSession: true },
  { at: '00:40', state: 'longQuery', seconds: '6000', isBackupSession: true },
  { at: '00:45', state: 'longQuery', seconds: '6300', isBackupSession: true },
  { at: '00:50', state: 'probe', exit: '124' }, // MAILED
  { at: '00:55', state: 'ok' }, // MAILED (recovery)
  // Five quiet hours, replayed at reduced cadence — see the header.
  { at: '01:00', state: 'ok' },
  { at: '03:00', state: 'ok' },
  { at: '05:55', state: 'ok' },
  { at: '06:00', state: 'poolBusy', inUse: '48' }, // MAILED
  { at: '06:05', state: 'ok' }, // MAILED (recovery)
  { at: '06:10', state: 'ok' },
  { at: '06:15', state: 'ok' },
  { at: '06:20', state: 'ok' },
  { at: '06:25', state: 'probe', exit: '124' }, // MAILED
  { at: '06:30', state: 'ok' }, // MAILED (recovery)
  { at: '06:35', state: 'ok' },
  { at: '06:40', state: 'ok' },
  { at: '06:45', state: 'ok' },
  { at: '06:50', state: 'ok' },
  { at: '06:55', state: 'ok' },
  { at: '07:00', state: 'poolBusy', inUse: '60' }, // MAILED
  { at: '07:05', state: 'poolBusy', inUse: '60' },
  { at: '07:10', state: 'poolBusy', inUse: '60' },
  { at: '07:15', state: 'poolBusy', inUse: '60' },
  { at: '07:20', state: 'poolBusy', inUse: '60' },
  { at: '07:25', state: 'poolBusy', inUse: '60' },
  { at: '07:30', state: 'poolBusy', inUse: '60' },
  { at: '07:35', state: 'poolBusy', inUse: '60' },
  { at: '07:40', state: 'poolBusy', inUse: '60' },
  // The dump ended ~00:52, so this one is a REAL query and must still be reported.
  { at: '07:45', state: 'longQuery', seconds: '233', isBackupSession: false },
];

const envForRun = (run: Run): Record<string, string> => {
  switch (run.state) {
    case 'ok':
      return {};
    case 'probe':
      return { FAKE_DB_EXIT: run.exit };
    case 'longQuery':
      // The dump's own session is filtered inside the probe SQL, which these fakes do not
      // evaluate — so an exempt session simply reports no long query, exactly as the real
      // probe now does. Covered for real in health-alert-db-probe.integration.spec.ts.
      return run.isBackupSession ? {} : { FAKE_LONG_Q: '1', FAKE_LONGEST: run.seconds };
    case 'poolBusy':
      return { FAKE_POOL_IN_USE: run.inUse, FAKE_POOL_LIMIT: '60' };
  }
};

describe('health-alert.sh replaying the night of 2026-08-25', () => {
  // Each replay spawns the script ~40 times; a single spawn may take up to 10s
  // (spawnSync timeout above), so vitest's 5s default flakes on slow CI runners.
  const REPLAY_TIMEOUT_MS = 60_000;

  const replay = (): { alerts: string[]; recoveries: number } => {
    const alerts: string[] = [];
    let recoveries = 0;
    let seenMails = 0;

    for (const entry of NIGHT_OF_2026_08_25) {
      run(envForRun(entry));
      const log = readStateFile('mail.log');
      const mails = log.split('---MAIL---').slice(1);
      for (const mail of mails.slice(seenMails)) {
        if (mail.includes('recovered at')) {
          recoveries++;
        } else {
          // Keep the body, not just a count: an assertion on the number alone cannot tell
          // "damped the storm" from "stopped reporting".
          alerts.push(
            `${entry.at} ${mail
              .replace(/\s+/g, ' ')
              .replace(/.*Problems found: /, '')
              // Body-only sections, in the order they appear. This assertion is about
              // WHICH problems were reported and when; the diagnostic context appended
              // after them is covered by its own tests.
              .replace(/ Database probe stderr.*/, '')
              .replace(/ (Note|Server):.*/, '')}`,
          );
        }
      }
      seenMails = mails.length;
    }
    return { alerts, recoveries };
  };

  it(
    'reports every distinct problem exactly once instead of storming',
    () => {
      const { alerts, recoveries } = replay();

      // Five mails for five genuinely separate events, where the shipped script sent
      // thirteen. The rotating 143/128 exit codes are folded into the 124 that opened the
      // incident. The 06:00 pool spike lasted a single run and self-healed, so the
      // persistence gate sends nothing for it; the 07:00 saturation is sustained and
      // pages one interval later, at 07:05, with the repeat runs to 07:40 folded into it.
      //
      // 00:50 is NOT a duplicate of 23:35 and must stay: with the dump's own session
      // exempted, 00:10-00:45 are healthy runs, so that incident CLOSED (recovery below)
      // and 00:50 opened a new one. Folding a failure into an incident that already
      // recovered is how a monitor goes quiet on a recurring fault.
      expect(alerts).toEqual([
        '23:35 Database monitoring checks failed (exit 124)',
        '00:50 Database monitoring checks failed (exit 124)',
        '06:25 Database monitoring checks failed (exit 124)',
        '07:05 Connection pool 100% busy (60 of 60 running a query or in a transaction)',
        '07:45 1 query(s) active longer than 120s (longest: 233s)',
      ]);
      // One per incident that actually cleared, and never on a single-run blip. The
      // 06:00 spike never opened an incident, so it gets none; the 07:00 incident is
      // still open at 07:45, so it correctly gets none either.
      expect(recoveries).toBe(3);
      // 16 mails on the shipped script, 8 here. Four of those eight are the 23:00-01:00
      // cluster, which exists only because the dump was still taking ~112 minutes; that
      // window goes quiet once the retention sweep runs and the dump shrinks again.
      expect(alerts.length + recoveries).toBeLessThanOrEqual(8);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    'still reports a genuinely new problem while an old one is unresolved',
    () => {
      // The failure mode a naive rate-limit introduces: 07:45's long query arrives while
      // the pool has been busy since 07:00 and the incident is still open. Suppressing it
      // would be a silent monitoring outage, which is worse than the storm.
      const { alerts } = replay();

      expect(alerts.at(-1)).toContain('1 query(s) active longer than 120s');
    },
    REPLAY_TIMEOUT_MS,
  );
});
