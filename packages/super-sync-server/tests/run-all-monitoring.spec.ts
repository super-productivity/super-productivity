import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('complete monitoring runner', () => {
  let previousExitCode: typeof process.exitCode;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it('uses the operations-free active-user command by default', async () => {
    const monitoring = await import('../scripts/run-all-monitoring');
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    await monitoring.runMonitoringSuite(['--quick'], execute);

    expect(execute.mock.calls.map(([command]) => command)).toContainEqual(
      expect.stringContaining('active-users-quick'),
    );
  });

  it('omits global user-data reports from a focused-user run', async () => {
    const monitoring = await import('../scripts/run-all-monitoring');
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    await monitoring.runMonitoringSuite(['--user', '42'], execute);

    const commands = execute.mock.calls.map(([command]) => String(command));
    expect(commands).toContainEqual(expect.stringContaining('ops --user 42'));
    expect(commands).toContainEqual(expect.stringContaining('operation-types --user 42'));
    expect(commands.some((command) => command.includes('active-users-quick'))).toBe(
      false,
    );
    expect(commands.some((command) => command.includes('monitor.ts usage'))).toBe(false);
    expect(commands.some((command) => command.includes('large-ops'))).toBe(false);
    expect(commands.some((command) => command.includes('rapid-fire'))).toBe(false);
    expect(commands.some((command) => command.includes('snapshot-analysis'))).toBe(false);
  });

  it('preserves partial output and fails the suite when a child command fails', async () => {
    const monitoring = await import('../scripts/run-all-monitoring');
    const execute = vi.fn(async (command: string) => {
      if (command.includes('monitor.ts usage')) {
        throw Object.assign(new Error('child failed'), {
          stdout: 'partial report output',
          stderr: 'query timed out',
        });
      }
      return { stdout: '', stderr: '' };
    });

    const result = await monitoring.runMonitoringSuite(['--quick'], execute);

    expect(execute).toHaveBeenCalledTimes(9);
    expect(result.failed).toBe(1);
    expect(result.failedNames).toEqual(['User Storage']);
    expect(result.results.find(({ name }) => name === 'User Storage')?.output).toContain(
      'partial report output',
    );
    expect(process.exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Error running User Storage: child failed\nquery timed out',
    );
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(
      '❌ Monitoring incomplete; see failed commands above.\n',
    );
  });
});
