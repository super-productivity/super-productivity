// Installs the plugin-dev workspace (every plugin + issue-provider-kit) from
// its single package-lock.json. Uses `npm ci`, so a build never rewrites the
// lockfile; it runs only when node_modules is missing or older than the lock.

const { execSync } = require('child_process');
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

// npm reports a duplicate workspace name (e.g. a copied plugin folder) as a
// missing lockfile, so name the colliding folders ourselves.
function findDuplicateNames() {
  const dirsByName = new Map();
  for (const entry of fs.readdirSync(PLUGIN_DEV_DIR, { withFileTypes: true })) {
    // existsSync follows symlinks (npm does too) and is false for plain files
    const pkgPath = path.join(PLUGIN_DEV_DIR, entry.name, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      continue;
    }
    try {
      // npm names a workspace without "name" after its folder
      const name = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name || entry.name;
      dirsByName.set(name, [...(dirsByName.get(name) || []), entry.name]);
    } catch {
      // npm reports unparsable package.json files itself
    }
  }
  return [...dirsByName].filter(([, dirs]) => dirs.length > 1);
}

function ensurePluginDeps({ log = console.log, silent = false } = {}) {
  if (!needsInstall()) {
    return false;
  }
  log('  Installing plugin-dev workspace dependencies (npm ci)...');
  try {
    // Plugin build tools are devDependencies: keep them under NODE_ENV=production.
    // A shell command resolves npm.cmd on Windows; the arguments are fixed.
    execSync('npm ci --include=dev --no-audit --no-fund', {
      cwd: PLUGIN_DEV_DIR,
      stdio: silent ? 'pipe' : 'inherit',
    });
  } catch (e) {
    const duplicates = findDuplicateNames();
    e.message += duplicates.length
      ? '\nplugin-dev install failed: every plugin folder is an npm workspace and needs a ' +
        'unique package.json "name". Duplicates: ' +
        duplicates.map(([name, dirs]) => `"${name}" in ${dirs.join(', ')}`).join('; ')
      : '\nplugin-dev install failed. If a package.json changed, update the lockfile with ' +
        '`npm install` in packages/plugin-dev.';
    throw e;
  }
  return true;
}

module.exports = { ensurePluginDeps };
