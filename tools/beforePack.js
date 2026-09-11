'use strict';

const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const MAC_ICON_GENERATOR = join(__dirname, 'generate-mac-icon.js');
let isMacIconCompiled = false;

const beforePack = (context) => {
  const isMac =
    context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas';
  if (!isMac || isMacIconCompiled) return;

  execFileSync(process.execPath, [MAC_ICON_GENERATOR, '--compile-only'], {
    stdio: 'inherit',
  });
  isMacIconCompiled = true;
};

module.exports = beforePack;
