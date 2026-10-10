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
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
# A dll that fails to load is deleted so the next poll recompiles it.
try { Add-Type -Path $dll } catch { Remove-Item $dll -ErrorAction SilentlyContinue; throw }
$h = [SpAutoTrackFg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][SpAutoTrackFg]::GetWindowText($h, $sb, $sb.Capacity)
[uint32]$procId = 0
[void][SpAutoTrackFg]::GetWindowThreadProcessId($h, [ref]$procId)
$name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Always one line for the app, even when the process is gone, so the title stays line 2.
Write-Output ([string]$name)
Write-Output $sb.ToString()
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
const run = (file, argv, env) => new Promise((resolve) => {
  cp.execFile(file, argv, { timeout: 8000, windowsHide: true, encoding: 'utf8', maxBuffer: 65536, env },
    (err, stdout) => resolve(err ? { error: String(err.code || 'EXEC_FAILED') } : { stdout }));
});
if (process.platform === 'darwin') {
  const argv = ${JSON.stringify(MAC_APPLESCRIPT)}.flatMap((line) => ['-e', line]);
  return { platform: 'darwin', ...(await run('/usr/bin/osascript', argv, {})) };
}
if (process.platform === 'win32') {
  const root = path.parse(os.homedir()).root;
  const systemRoot = path.join(root, 'Windows');
  const temp = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
  fs.mkdirSync(temp, { recursive: true });
  const env = { SystemRoot: systemRoot, windir: systemRoot, TEMP: temp, TMP: temp };
  const ps = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', ${JSON.stringify(encodePowerShell(WIN_POWERSHELL))}];
  return { platform: 'win32', ...(await run(ps, argv, env)) };
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
