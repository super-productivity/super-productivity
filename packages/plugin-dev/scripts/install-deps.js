#!/usr/bin/env node

// Installs the plugin-dev workspace (every plugin + issue-provider-kit) from
// its single package-lock.json. Uses `npm ci`, so a build never rewrites the
// lockfile; it runs only when node_modules is missing or older than the lock.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLUGIN_DEV_DIR = path.join(__dirname, '..');
const LOCKFILE = path.join(PLUGIN_DEV_DIR, 'package-lock.json');
// npm writes this "hidden lockfile" at the end of every successful install.
const HIDDEN_LOCKFILE = path.join(PLUGIN_DEV_DIR, 'node_modules', '.package-lock.json');

function needsInstall() {
  if (!fs.existsSync(HIDDEN_LOCKFILE)) {
    return true;
  }
  return fs.statSync(LOCKFILE).mtimeMs > fs.statSync(HIDDEN_LOCKFILE).mtimeMs;
}

function ensurePluginDeps({ log = console.log, silent = false } = {}) {
  if (!needsInstall()) {
    return false;
  }
  log('  Installing plugin-dev workspace dependencies (npm ci)...');
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: PLUGIN_DEV_DIR,
    stdio: silent ? 'pipe' : 'inherit',
    // npm is npm.cmd on Windows
    shell: process.platform === 'win32',
  });
  return true;
}

if (require.main === module) {
  ensurePluginDeps();
}

module.exports = { ensurePluginDeps };
