import type { WindowSample } from './match';

// System Events needs the macOS Automation permission; the window title additionally
// needs Accessibility. Without it the title stays empty and only app rules can match.
const MAC_APPLESCRIPT = [
  'tell application "System Events"',
  'set frontProc to first application process whose frontmost is true',
  'set appName to name of frontProc',
  'set winTitle to ""',
  'try',
  'set winTitle to name of front window of frontProc',
  'end try',
  // some windows report `missing value`, which would make the concatenation below throw
  'if winTitle is missing value then set winTitle to ""',
  'end tell',
  'return appName & linefeed & winTitle',
];

// Add-Type compiles C# (csc) on every call, which costs ~1s CPU. Compile once into a
// versioned dll in %TEMP% and load that afterwards; bump the name when the C# changes.
const WIN_POWERSHELL = `
$ErrorActionPreference = 'Stop'
$dll = Join-Path $env:TEMP 'sp-app-auto-track-v1.dll'
if (-not (Test-Path $dll)) {
  # Compile under a unique name, then move: a compile killed by the timeout must not
  # leave a half-written dll at the final path. A lost race just drops its own copy.
  $tmp = Join-Path $env:TEMP ('sp-app-auto-track-' + [guid]::NewGuid() + '.dll')
  Add-Type -OutputAssembly $tmp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SpAutoTrackFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
  Move-Item $tmp $dll -ErrorAction SilentlyContinue
  # The move fails if another probe won the race (drop ours) or e.g. AV holds the file
  # (use ours this once rather than failing every poll).
  if (Test-Path $tmp) {
    if (Test-Path $dll) { Remove-Item $tmp -ErrorAction SilentlyContinue } else { $dll = $tmp }
  }
}
# A dll that fails to load is deleted so the next poll recompiles it.
try { Add-Type -Path $dll } catch { Remove-Item $dll -ErrorAction SilentlyContinue; throw }
$h = [SpAutoTrackFg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][SpAutoTrackFg]::GetWindowText($h, $sb, $sb.Capacity)
[uint32]$procId = 0
[void][SpAutoTrackFg]::GetWindowThreadProcessId($h, [ref]$procId)
# pid 0 is "Idle": no foreground window (lock screen, UAC desktop)
$name = ''
if ($procId -ne 0) { $name = [string](Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName }
# Base64 sidesteps console code pages, BOMs and line wrapping of the hidden console.
$text = $name + [char]10 + $sb.ToString()
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
`;

/** UTF-16LE base64, as `powershell -EncodedCommand` expects; avoids all quoting issues. */
const encodePowerShell = (script: string): string => {
  const bytes: number[] = [];
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    bytes.push(code & 0xff, code >> 8);
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/**
 * Node script run through `executeNodeScript` (spawn path: it uses child_process).
 * The executor strips the child env (no PATH/SystemRoot/TEMP), so binaries are
 * addressed by absolute path and Windows gets a minimal env rebuilt from the profile.
 * Returns raw output only; parsing happens in the plugin where it can be tested.
 */
export const buildProbeScript = (): string => `
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
// -1743: the user denied (or has not yet answered) the Automation prompt for System Events
const errorCode = (err, stderr) =>
  err.killed ? 'TIMEOUT' : /-1743/.test(stderr) ? 'AUTOMATION_DENIED' : String(err.code || 'EXEC_FAILED');
const run = (file, argv, env) => new Promise((resolve) => {
  cp.execFile(file, argv, { timeout: 25000, windowsHide: true, encoding: 'utf8', maxBuffer: 65536, env },
    (err, stdout, stderr) => resolve(err ? { error: errorCode(err, String(stderr)) } : { stdout }));
});
if (process.platform === 'darwin') {
  const argv = ${JSON.stringify(MAC_APPLESCRIPT)}.flatMap((line) => ['-e', line]);
  return { platform: 'darwin', ...(await run('/usr/bin/osascript', argv, {})) };
}
if (process.platform === 'win32') {
  // C: first: another drive's root (a redirected or UNC home) may be user-writable, so
  // a planted powershell.exe there must not win. The home drive is only the fallback
  // for Windows installed elsewhere (where a user-created C:\\Windows would still win;
  // the stripped child env offers no trusted SystemRoot).
  const psIn = (root) => path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const systemRoot = [path.join('C:/', 'Windows'), path.join(path.parse(os.homedir()).root, 'Windows')]
    .find((root) => fs.existsSync(psIn(root)));
  if (!systemRoot) return { platform: 'win32', error: 'NO_POWERSHELL' };
  const temp = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
  fs.mkdirSync(temp, { recursive: true });
  const env = { SystemRoot: systemRoot, windir: systemRoot, TEMP: temp, TMP: temp };
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', ${JSON.stringify(encodePowerShell(WIN_POWERSHELL))}];
  const res = await run(psIn(systemRoot), argv, env);
  return { platform: 'win32', ...(res.stdout === undefined ? res
    : { stdout: Buffer.from(res.stdout.trim(), 'base64').toString('utf8') }) };
}
return { platform: process.platform, unsupported: true };
`;

export type ProbeResult =
  | { kind: 'sample'; sample: WindowSample }
  | { kind: 'unsupported' }
  | { kind: 'error'; code: string };

interface RawProbeOutput {
  platform?: unknown;
  stdout?: unknown;
  error?: unknown;
  unsupported?: unknown;
}

/** Turns the probe script's raw output into a sample: line 1 = app, rest = title. */
export const parseProbeResult = (raw: unknown): ProbeResult => {
  const out = (raw ?? {}) as RawProbeOutput;
  if (out.unsupported) return { kind: 'unsupported' };
  if (typeof out.stdout !== 'string') {
    return {
      kind: 'error',
      code: typeof out.error === 'string' ? out.error : 'NO_OUTPUT',
    };
  }
  const [app = '', ...titleLines] = out.stdout.replace(/\r/g, '').split('\n');
  return {
    kind: 'sample',
    sample: { app: app.trim(), title: titleLines.join(' ').trim() },
  };
};
