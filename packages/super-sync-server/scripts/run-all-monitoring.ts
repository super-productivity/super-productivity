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

interface MonitoringCommand {
  name: string;
  command: string;
  description: string;
  skipInQuick?: boolean;
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
      command: 'tsx scripts/monitor.ts stats',
      description: 'System vitals, DB connection, disk space',
    },
    {
      name: 'User Storage',
      command: 'tsx scripts/monitor.ts usage',
      description: 'Top 20 users by storage usage',
    },
    {
      name: 'Recent Operations',
      command: `tsx scripts/monitor.ts ops ${userFlag}`,
      description: 'Recent operations analysis',
    },

    // Storage Analysis - Quick checks
    {
      name: 'Operation Size Distribution',
      command: `tsx scripts/analyze-storage.ts operation-sizes ${userFlag}`,
      description: 'Analyze operation size patterns',
    },
    {
      name: 'Operation Types Breakdown',
      command: `tsx scripts/analyze-storage.ts operation-types ${userFlag}`,
      description: 'Breakdown by operation and entity types',
    },
    {
      name: 'Largest Operations',
      command: 'tsx scripts/analyze-storage.ts large-ops --limit 20',
      description: 'Find and analyze largest operations',
    },
    {
      name: 'Rapid Fire Detection',
      command: 'tsx scripts/analyze-storage.ts rapid-fire --threshold 5',
      description: 'Detect potential sync loops',
    },
    {
      name: 'Snapshot Analysis',
      command: 'tsx scripts/analyze-storage.ts snapshot-analysis',
      description: 'Analyze snapshot usage patterns',
    },

    // Deep Analysis (skip in quick mode)
    {
      name: 'Operation Timeline',
      command: `tsx scripts/analyze-storage.ts operation-timeline ${userFlag}`,
      description: 'Temporal patterns and trends',
      skipInQuick: true,
    },
  ];
};

// ============================================================================
// Runner
// ============================================================================

const runCommand = async (cmd: MonitoringCommand): Promise<string> => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Running: ${cmd.name}`);
  console.log(`Description: ${cmd.description}`);
  console.log('='.repeat(80));

  try {
    const { stdout, stderr } = await execAsync(cmd.command, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    if (stderr && !stderr.includes('ExperimentalWarning')) {
      console.error('Warnings:', stderr);
    }

    console.log(stdout);
    return stdout;
  } catch (error: any) {
    const errorMsg = `Error running ${cmd.name}: ${error.message}`;
    console.error(errorMsg);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    return errorMsg;
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
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
  const commandsToRun = quickMode ? commands.filter((cmd) => !cmd.skipInQuick) : commands;

  const outputs: string[] = [];

  // Run all commands
  for (const cmd of commandsToRun) {
    const output = await runCommand(cmd);
    outputs.push(`\n${'='.repeat(80)}\n${cmd.name}\n${'='.repeat(80)}\n${output}`);
  }

  // Summary
  const duration = Date.now() - startTime;
  const summary = `
${'='.repeat(80)}
MONITORING SUMMARY
${'='.repeat(80)}
Completed: ${new Date().toLocaleString()}
Duration: ${(duration / 1000).toFixed(1)}s
Commands Run: ${commandsToRun.length}
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
      ...outputs,
      summary,
    ].join('\n');

    fs.writeFileSync(filepath, fullReport);
    console.log(`\nReport saved to: ${filepath}`);
    console.log(`Size: ${(fullReport.length / 1024).toFixed(1)} KB\n`);
  }

  console.log('✅ Monitoring complete!\n');
};

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
