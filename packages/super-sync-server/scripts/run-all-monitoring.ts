#!/usr/bin/env tsx
/**
 * SuperSync Complete Monitoring Suite Runner
 *
 * Runs all monitoring and analysis scripts in sequence and optionally saves output.
 *
 * Usage:
 *   npm run monitor:all                    Run all checks (output to console)
 *   npm run monitor:all -- --save          Save output to timestamped file
 *   npm run monitor:all -- --quick         Run only quick checks (skip deep analysis)
 *   npm run monitor:all -- --user <id>     Focus on specific user
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const LOG_DIR = path.join(process.cwd(), 'monitoring-reports');

// When invoked via docker-monitor.sh, this runs as compiled JS from dist/.
// When invoked via `npm run monitor:all`, this runs as TypeScript via tsx.
const isCompiled = __filename.includes(`${path.sep}dist${path.sep}`);
const cmd = (script: string, args: string): string =>
  isCompiled
    ? `node dist/scripts/${script}.js ${args}`
    : `tsx scripts/${script}.ts ${args}`;

interface MonitoringCommand {
  name: string;
  command: string;
  description: string;
  skipInQuick?: boolean;
  skipInUserFocus?: boolean;
}

// ============================================================================
// Monitoring Commands Configuration
// ============================================================================

const getMonitoringCommands = (userId?: number): MonitoringCommand[] => {
  const userFlag = userId ? `--user ${userId}` : '';

  return [
    // System Health
    {
      name: 'System Stats',
      command: cmd('monitor', 'stats'),
      description: 'System vitals, DB connection, disk space',
    },
    {
      name: 'Active Users',
      command: cmd('monitor', 'active-users-quick'),
      description: 'Active users by device heartbeat',
      skipInUserFocus: true,
    },
    {
      name: 'User Storage',
      command: cmd('monitor', 'usage'),
      description: 'Top 20 users by storage usage',
      skipInUserFocus: true,
    },
    {
      name: 'Recent Operations',
      command: cmd('monitor', `ops ${userFlag}`),
      description: 'Recent operations analysis (bounded per-user sample)',
    },

    // Storage Analysis - Quick checks
    {
      name: 'Operation Size Distribution',
      command: cmd('analyze-storage', `operation-sizes ${userFlag}`),
      description: 'Analyze operation size patterns',
    },
    {
      name: 'Operation Types Breakdown',
      command: cmd('analyze-storage', `operation-types ${userFlag}`),
      description: 'Breakdown by operation and entity types',
    },
    {
      name: 'Largest Operations',
      command: cmd('analyze-storage', 'large-ops --limit 20'),
      description: 'Find and analyze largest operations',
      skipInUserFocus: true,
    },
    {
      name: 'Rapid Fire Detection',
      command: cmd('analyze-storage', 'rapid-fire --threshold 5'),
      description: 'Detect potential sync loops',
      skipInUserFocus: true,
    },
    {
      name: 'Snapshot Analysis',
      command: cmd('analyze-storage', 'snapshot-analysis'),
      description: 'Analyze snapshot usage patterns',
      skipInUserFocus: true,
    },

    // Deep Analysis (skip in quick mode)
    {
      name: 'Operation Timeline',
      command: cmd('analyze-storage', `operation-timeline ${userFlag}`),
      description: 'Temporal patterns and trends',
      skipInQuick: true,
    },
  ];
};

// ============================================================================
// Runner
// ============================================================================

interface MonitoringCommandResult {
  name: string;
  output: string;
  success: boolean;
}

interface MonitoringRunResult {
  failed: number;
  failedNames: string[];
  results: MonitoringCommandResult[];
}

interface CommandExecutionOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}

type CommandExecutor = (
  command: string,
  options: CommandExecutionOptions,
) => Promise<{ stdout: string; stderr: string }>;

const executeCommand: CommandExecutor = async (command, options) => {
  const { stdout, stderr } = await execAsync(command, options);
  return { stdout, stderr };
};

const runCommand = async (
  cmd: MonitoringCommand,
  executor: CommandExecutor,
): Promise<MonitoringCommandResult> => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Running: ${cmd.name}`);
  console.log(`Description: ${cmd.description}`);
  console.log('='.repeat(80));

  try {
    const { stdout, stderr } = await executor(cmd.command, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    if (stderr && !stderr.includes('ExperimentalWarning')) {
      console.error('Warnings:', stderr);
    }

    console.log(stdout);
    return { name: cmd.name, output: stdout, success: true };
  } catch (error: unknown) {
    const execError = error as { message?: string; stdout?: string; stderr?: string };
    const errorMessage = execError.message ?? String(error);
    const stderr = typeof execError.stderr === 'string' ? execError.stderr.trim() : '';
    const errorDetail =
      stderr && !errorMessage.includes(stderr)
        ? `${errorMessage}\n${stderr}`
        : errorMessage;
    const errorMsg = `Error running ${cmd.name}: ${errorDetail}`;
    console.error(errorMsg);
    if (execError.stdout) console.log(execError.stdout);
    const output = [execError.stdout, errorMsg]
      .filter((part): part is string => Boolean(part))
      .join('\n');
    return { name: cmd.name, output, success: false };
  }
};

export const runMonitoringSuite = async (
  args = process.argv.slice(2),
  executor: CommandExecutor = executeCommand,
): Promise<MonitoringRunResult> => {
  const saveOutput = args.includes('--save');
  const quickMode = args.includes('--quick');
  const userIdArg = args.indexOf('--user');
  const userId = userIdArg !== -1 ? parseInt(args[userIdArg + 1], 10) : undefined;

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║        SuperSync Complete Monitoring Suite                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  console.log(`Started: ${new Date().toLocaleString()}`);
  if (quickMode) console.log('Mode: Quick (skipping deep analysis)');
  if (userId) console.log(`Focus: User ${userId}`);
  console.log('');

  const commands = getMonitoringCommands(userId);
  const scopedCommands = userId
    ? commands.filter((command) => !command.skipInUserFocus)
    : commands;
  const commandsToRun = quickMode
    ? scopedCommands.filter((command) => !command.skipInQuick)
    : scopedCommands;

  const results: MonitoringCommandResult[] = [];

  // Run all commands
  for (const cmd of commandsToRun) {
    results.push(await runCommand(cmd, executor));
  }

  // Summary
  const duration = Date.now() - startTime;
  const failedNames = results.filter((result) => !result.success).map(({ name }) => name);
  const resultSummary = { failed: failedNames.length, failedNames };
  const summary = `
${'='.repeat(80)}
MONITORING SUMMARY
${'='.repeat(80)}
Completed: ${new Date().toLocaleString()}
Duration: ${(duration / 1000).toFixed(1)}s
Commands Run: ${commandsToRun.length}
Commands Failed: ${resultSummary.failed}${
    resultSummary.failed > 0 ? ` (${resultSummary.failedNames.join(', ')})` : ''
  }
${userId ? `User Focus: ${userId}` : 'All Users'}
${'='.repeat(80)}
`;

  console.log(summary);

  // Save to file if requested
  if (saveOutput) {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = userId
      ? `monitoring-user-${userId}-${timestamp}.txt`
      : `monitoring-full-${timestamp}.txt`;
    const filepath = path.join(LOG_DIR, filename);

    const fullReport = [
      '╔════════════════════════════════════════════════════════════════╗',
      '║        SuperSync Monitoring Report                            ║',
      '╚════════════════════════════════════════════════════════════════╝',
      '',
      `Generated: ${new Date().toLocaleString()}`,
      `Duration: ${(duration / 1000).toFixed(1)}s`,
      userId ? `User: ${userId}` : 'Scope: All Users',
      '',
      ...results.map(
        (result) =>
          `\n${'='.repeat(80)}\n${result.name}\n${'='.repeat(80)}\n${result.output}`,
      ),
      summary,
    ].join('\n');

    fs.writeFileSync(filepath, fullReport);
    console.log(`\nReport saved to: ${filepath}`);
    console.log(`Size: ${(fullReport.length / 1024).toFixed(1)} KB\n`);
  }

  if (resultSummary.failed > 0) {
    process.exitCode = 1;
    console.log('❌ Monitoring incomplete; see failed commands above.\n');
  } else {
    console.log('✅ Monitoring complete!\n');
  }

  return { ...resultSummary, results };
};

if (require.main === module) {
  runMonitoringSuite().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
