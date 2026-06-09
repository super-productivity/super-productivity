#!/usr/bin/env ts-node

import { runLogMigration } from './log-migration-helper';

runLogMigration({
  description: 'Migrating Log to IssueLog in features/issue directory...',
  fileLabel: 'TypeScript files in features/issue directory',
  globPattern: 'src/app/features/issue/**/*.ts',
  targetLogName: 'IssueLog',
});
