#!/usr/bin/env node

// eslint-env node, es2021

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function getPlugins() {
  const pluginDevDir = path.join(__dirname, 'plugin-dev');
  const entries = await fs.readdir(pluginDevDir, { withFileTypes: true });

  const plugins = [];

  // Add shared-schema first as it's needed for type resolution
  plugins.push({
    name: 'shared-schema',
    path: 'packages/shared-schema',
    buildCommand: 'npm run build',
    skipCopy: true,
  });

  // Add plugin-api as it's a dependency for plugins
  plugins.push({
    name: 'plugin-api',
    path: 'packages/plugin-api',
    buildCommand: 'npm run build',
    skipCopy: true,
  });

  // Add vite-plugin as it's a build dependency
  plugins.push({
    name: 'vite-plugin',
    path: 'packages/vite-plugin',
    buildCommand: 'npm run build',
    skipCopy: true,
  });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pluginPath = path.join(pluginDevDir, entry.name);
      const packageJsonPath = path.join(pluginPath, 'package.json');

      try {
        await fs.access(packageJsonPath);
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

        // Skip boilerplate
        if (entry.name === 'boilerplate-solid-js') continue;

        const buildScript = packageJson.scripts && packageJson.scripts.build;
        // Check if it's a real build script or just a placeholder
        const hasRealBuildScript =
          buildScript && !buildScript.includes("echo 'No build needed");

        plugins.push({
          name: entry.name,
          path: `packages/plugin-dev/${entry.name}`,
          buildCommand: hasRealBuildScript ? 'npm run build' : undefined,
          // Standard files to copy for bundled plugins
          files: ['manifest.json', 'plugin.js', 'index.html', 'icon.svg'],
          sourcePath: hasRealBuildScript ? 'dist' : undefined,
        });
      } catch (e) {
        // Not a package, skip
      }
    }
  }

  return plugins;
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function copyFile(src, dest) {
  try {
    // console.log(`Copying ${src} to ${dest}`);
    await fs.copyFile(src, dest);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      log(`  ❌ Missing expected file: ${path.basename(src)} (path: ${src})`, colors.red);
      // We want to fail if a file is missing
      throw new Error(`Missing expected file: ${path.basename(src)}`);
    } else {
      log(`  ❌ Failed to copy ${path.basename(src)}: ${error.message}`, colors.red);
      throw error;
    }
  }
}

async function buildPlugin(plugin) {
  const startTime = Date.now();
  log(`\n📦 Processing ${plugin.name}...`, colors.cyan);

  try {
    // Check if plugin directory exists
    const pluginPath = path.resolve(plugin.path);
    try {
      await fs.access(pluginPath);
    } catch {
      throw new Error(`Plugin directory not found: ${plugin.path}`);
    }

    // Run build command if specified
    if (plugin.buildCommand) {
      log(`  Building...`, colors.yellow);
      const packageJsonPath = path.join(pluginPath, 'package.json');

      // Check if package.json exists and install dependencies if needed
      try {
        await fs.access(packageJsonPath);
        const nodeModulesPath = path.join(pluginPath, 'node_modules');
        try {
          await fs.access(nodeModulesPath);
        } catch {
          log(`  Installing dependencies...`, colors.yellow);
          await execAsync(`cd ${pluginPath} && npm install`);
        }
      } catch {
        // No package.json, skip install
      }

      await execAsync(`cd ${pluginPath} && ${plugin.buildCommand}`);
    }

    // Copy files to assets if not skipped
    if (!plugin.skipCopy) {
      const targetDir = path.join('src/assets/bundled-plugins', plugin.name);
      await fs.rm(targetDir, { recursive: true, force: true });
      await ensureDir(targetDir);

      const filesToCopy = plugin.files || [];

      // Prefer dist if it exists, otherwise fall back to plugin root (for simple plugins)
      const preferredSourcePath = plugin.sourcePath
        ? path.join(pluginPath, plugin.sourcePath)
        : path.join(pluginPath, 'dist');
      const distExists = await pathExists(preferredSourcePath);
      const sourcePath = distExists ? preferredSourcePath : pluginPath;

      const requiredFiles = plugin.requiredFiles || filesToCopy;
      const missingFiles = [];

      if (distExists) {
        // Copy the full dist to preserve all chunks/assets
        await fs.cp(sourcePath, targetDir, { recursive: true });
      } else {
        // Simple plugins: copy listed files from the root
        for (const file of filesToCopy) {
          const src = path.join(sourcePath, file);
          const dest = path.join(targetDir, file);
          try {
            if (!(await copyFile(src, dest))) {
              missingFiles.push(file);
            }
          } catch (e) {
            throw e;
          }
        }
      }

      // Validate required files exist after copy
      for (const file of requiredFiles) {
        const dest = path.join(targetDir, file);
        if (!(await pathExists(dest))) {
          missingFiles.push(file);
        }
      }

      if (missingFiles.length) {
        throw new Error(
          `Missing required asset(s) for ${plugin.name}: ${missingFiles.join(', ')}`,
        );
      }

      if (distExists) {
        log(`  ✅ Copied dist to assets (${plugin.name})`, colors.green);
      } else {
        log(
          `  ✅ Copied ${filesToCopy.length}/${filesToCopy.length} files to assets`,
          colors.green,
        );
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ ${plugin.name} completed (${duration}s)`, colors.green);

    return { plugin: plugin.name, success: true, duration };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`❌ ${plugin.name} failed: ${error.message} (${duration}s)`, colors.red);
    return { plugin: plugin.name, success: false, error: error.message, duration };
  }
}

async function buildAll() {
  log('🚀 Building all packages...', colors.bright);
  const startTime = Date.now();

  const plugins = await getPlugins();

  // Build plugins sequentially to avoid conflicts
  const results = [];
  for (const plugin of plugins) {
    const result = await buildPlugin(plugin);
    results.push(result);
  }

  // Summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log('\n📊 Build Summary:', colors.bright);
  log(`  Total packages: ${plugins.length}`);
  log(`  Successful: ${successful}`, colors.green);
  if (failed > 0) {
    log(`  Failed: ${failed}`, colors.red);
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        log(`    - ${r.plugin}: ${r.error}`, colors.red);
      });
  }
  log(`  Total time: ${totalDuration}s`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  buildAll().catch((error) => {
    log(`\n❌ Build failed: ${error.message}`, colors.red);
    process.exit(1);
  });
}

module.exports = { buildAll };
