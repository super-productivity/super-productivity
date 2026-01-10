#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
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
  if (process.argv.includes('--silent')) return;
  console.log(`${color}${message}${colors.reset}`);
}

// Plugin configurations
const plugins = [
  {
    name: 'procrastination-buster',
    path: 'procrastination-buster',
    needsInstall: true,
    copyToAssets: true,
    buildCommand: async (pluginPath) => {
      await execAsync(`cd ${pluginPath} && npm run build`);
      // Copy to assets directory
      const targetDir = path.join(
        __dirname,
        '../../../src/assets/bundled-plugins/procrastination-buster',
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const distPath = path.join(pluginPath, 'dist');
      if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath);
        for (const file of files) {
          const src = path.join(distPath, file);
          const dest = path.join(targetDir, file);
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest);
          }
        }
      }
      return 'Built and copied to assets';
    },
  },
  // Migrated built-in plugins
  {
    name: 'api-test-plugin',
    path: 'api-test-plugin',
    needsInstall: true,
    copyToAssets: true,
    buildCommand: async (pluginPath) => {
      // Copy to assets directory
      const targetDir = path.join(
        __dirname,
        '../../../src/assets/bundled-plugins/api-test-plugin',
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const files = [
        'manifest.json',
        'plugin.js',
        'index.html',
        'config-schema.json',
        'icon.svg',
      ];
      for (const file of files) {
        const src = path.join(pluginPath, file);
        const dest = path.join(targetDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
      return 'Copied to assets';
    },
  },
  {
    name: 'sync-md',
    path: 'sync-md',
    needsInstall: true,
    copyToAssets: true,
    buildCommand: async (pluginPath) => {
      try {
        // Try normal build first
        await execAsync(`cd ${pluginPath} && npm run build`);
      } catch (buildError) {
        // If normal build fails, try emergency build
        console.log('  Normal build failed, trying emergency build...');
        await execAsync(`cd ${pluginPath} && node scripts/emergency-build.js`);
      }

      // Copy to assets directory
      const targetDir = path.join(
        __dirname,
        '../../../src/assets/bundled-plugins/sync-md',
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const distPath = path.join(pluginPath, 'dist');
      if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath);
        for (const file of files) {
          const src = path.join(distPath, file);
          const dest = path.join(targetDir, file);
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest);
          }
        }
      }
      return 'Built and copied to assets';
    },
  },
  {
    name: 'yesterday-tasks-plugin',
    path: 'yesterday-tasks-plugin',
    needsInstall: true,
    copyToAssets: true,
    buildCommand: async (pluginPath) => {
      // Copy to assets directory
      const targetDir = path.join(
        __dirname,
        '../../../src/assets/bundled-plugins/yesterday-tasks-plugin',
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const files = ['manifest.json', 'plugin.js', 'index.html', 'icon.svg'];
      for (const file of files) {
        const src = path.join(pluginPath, file);
        const dest = path.join(targetDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
      return 'Copied to assets';
    },
  },
  {
    name: 'ai-productivity-prompts',
    path: 'ai-productivity-prompts',
    needsInstall: true,
    copyToAssets: true,
    buildCommand: async (pluginPath) => {
      await execAsync(`cd ${pluginPath} && npm run build`);
      // Copy to assets directory
      const targetDir = path.join(
        __dirname,
        '../../../src/assets/bundled-plugins/ai-productivity-prompts',
      );
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const distPath = path.join(pluginPath, 'dist');
      if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath);
        for (const file of files) {
          const src = path.join(distPath, file);
          const dest = path.join(targetDir, file);
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest);
          }
        }
      }
      return 'Built and copied to assets';
    },
  },
];

async function buildPlugin(plugin) {
  const startTime = Date.now();
  log(`\n📦 Building ${plugin.name}...`, colors.cyan);

  try {
    // Check if plugin directory exists
    if (!fs.existsSync(plugin.path)) {
      throw new Error(`Plugin directory not found: ${plugin.path}`);
    }

    // Install dependencies if needed
    if (plugin.needsInstall) {
      const packageJsonPath = path.join(plugin.path, 'package.json');
      const nodeModulesPath = path.join(plugin.path, 'node_modules');

      if (fs.existsSync(packageJsonPath)) {
        log(`  Installing dependencies...`, colors.yellow);
        try {
          // Try to install dependencies
          await execAsync(`cd ${plugin.path} && npm install --include=dev`);
        } catch (installError) {
          // If install fails, check if node_modules exists and continue
          if (fs.existsSync(nodeModulesPath)) {
            log(
              `  Using existing dependencies (install failed but node_modules exists)`,
              colors.yellow,
            );
          } else {
            throw installError;
          }
        }
      }
    }

    // Run build command
    log(`  Building...`, colors.yellow);
    const result = await plugin.buildCommand(plugin.path);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ ${plugin.name} - ${result} (${duration}s)`, colors.green);

    return { plugin: plugin.name, success: true, duration };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`❌ ${plugin.name} - Build failed: ${error.message} (${duration}s)`, colors.red);

    return { plugin: plugin.name, success: false, error: error.message, duration };
  }
}

async function buildAll() {
  log('\n🚀 Building all plugins...', colors.bright);
  const startTime = Date.now();

  // Build plugins in parallel
  const results = await Promise.all(plugins.map(buildPlugin));

  // Summary
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log('\n📊 Build Summary:', colors.bright);
  log(`  Total plugins: ${plugins.length}`);
  log(`  Successful: ${successful}`, colors.green);
  if (failed > 0) {
    log(`  Failed: ${failed}`, colors.red);
  }
  log(`  Total time: ${totalDuration}s`);

  // List outputs
  log('\n📁 Build outputs:', colors.bright);

  // Check for minimal plugin zip
  if (fs.existsSync('minimal-plugin.zip')) {
    log(`  • minimal-plugin.zip`);
  }

  // Check for other plugin outputs
  for (const plugin of plugins.slice(1)) {
    const distPath = path.join(plugin.path, 'dist');
    if (fs.existsSync(distPath)) {
      const pluginZip = path.join(distPath, 'plugin.zip');
      if (fs.existsSync(pluginZip)) {
        const stats = fs.statSync(pluginZip);
        const size = (stats.size / 1024).toFixed(1);
        log(`  • ${plugin.path}/dist/plugin.zip (${size} KB)`);
      } else {
        log(`  • ${plugin.path}/dist/`);
      }
    }
  }

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
