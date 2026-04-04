import { DesktopCommand, DesktopCommandParseResult } from './desktop-command';

const ACTION_FLAG_COMMAND_PAIRS: ReadonlyArray<
  readonly [string, DesktopCommand['type']]
> = [
  ['--toggle-visibility', 'toggle-visibility'],
  ['--toggle-time-tracking', 'toggle-time-tracking'],
  ['--new-note', 'new-note'],
  ['--new-task', 'new-task'],
];

const PROTOCOL_PREFIX = 'superproductivity://';

export const parseDesktopCommandFromArgv = (
  argv: string[],
): DesktopCommandParseResult => {
  const matchingFlags = argv.filter((arg) =>
    ACTION_FLAG_COMMAND_PAIRS.some(([flag]) => flag === arg),
  );

  if (matchingFlags.length === 0) {
    return { kind: 'none' };
  }

  if (matchingFlags.length > 1) {
    return {
      kind: 'error',
      error: `Multiple desktop command flags are not supported: ${matchingFlags.join(', ')}`,
    };
  }

  const matchedFlag = matchingFlags[0];
  const commandType = ACTION_FLAG_COMMAND_PAIRS.find(
    ([flag]) => flag === matchedFlag,
  )?.[1];

  if (!commandType) {
    return { kind: 'none' };
  }

  return { kind: 'command', command: { type: commandType } as DesktopCommand };
};

export const parseDesktopCommandFromProtocolUrl = (
  url: string,
): DesktopCommandParseResult => {
  if (!url.startsWith(PROTOCOL_PREFIX)) {
    return { kind: 'none' };
  }

  try {
    const urlObj = new URL(url);
    const action = urlObj.hostname;
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    switch (action) {
      case 'create-task': {
        if (pathParts.length === 0) {
          return {
            kind: 'error',
            error: 'Protocol action "create-task" requires a task title',
          };
        }
        return {
          kind: 'command',
          command: { type: 'create-task', title: decodeURIComponent(pathParts[0]) },
        };
      }
      case 'task-toggle-start':
        return { kind: 'command', command: { type: 'toggle-time-tracking' } };
      default:
        return { kind: 'error', error: `Unknown protocol action: ${action}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      kind: 'error',
      error: `Failed to parse desktop command URL: ${errorMessage}`,
    };
  }
};

export const getProtocolUrlFromArgv = (argv: string[]): string | undefined =>
  argv.find((arg) => arg.startsWith(PROTOCOL_PREFIX));
