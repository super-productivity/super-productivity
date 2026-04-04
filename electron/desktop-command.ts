export type DesktopCommand =
  | { type: 'toggle-visibility' }
  | { type: 'toggle-time-tracking' }
  | { type: 'new-note' }
  | { type: 'new-task' }
  | { type: 'create-task'; title: string };

export type DesktopCommandParseResult =
  | { kind: 'none' }
  | { kind: 'command'; command: DesktopCommand }
  | { kind: 'error'; error: string };
