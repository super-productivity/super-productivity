#!/usr/bin/env ts-node

import { runLogMigration } from './log-migration-helper';

runLogMigration({
  description: 'Migrating Log to PluginLog in plugins directory...',
  fileLabel: 'TypeScript files in plugins directory',
  globPattern: 'src/app/plugins/**/*.ts',
  targetLogName: 'PluginLog',
});
