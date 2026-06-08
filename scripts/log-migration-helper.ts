import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

interface Replacement {
  pattern: RegExp;
  replacement: string;
}

export interface LogMigrationConfig {
  description: string;
  fileLabel: string;
  globPattern: string;
  targetLogName: string;
  ignore?: string[];
}

export interface MigrationResult {
  content: string;
  changes: number;
}

export interface FileMigrationResult {
  modified: boolean;
  changes: number;
}

const DEFAULT_IGNORE = ['**/*.spec.ts', '**/node_modules/**'];
const LOG_METHODS = ['log', 'err', 'info', 'debug', 'verbose', 'critical'];

const createReplacements = (targetLogName: string): Replacement[] =>
  LOG_METHODS.map((method) => ({
    pattern: new RegExp(`\\bLog\\.${method}\\(`, 'g'),
    replacement: `${targetLogName}.${method}(`,
  }));

const getTargetLogImportRegex = (targetLogName: string): RegExp =>
  new RegExp(
    `import\\s*{[^}]*\\b${targetLogName}\\b[^}]*}\\s*from\\s*['"][^'"]*\\/log['"]`,
  );

const LOG_IMPORT_REGEX = /import\s*{([^}]*\bLog\b[^}]*)}\s*from\s*(['"][^'"]*\/log['"])/;

const updateImports = (
  content: string,
  targetLogName: string,
  replacements: Replacement[],
): string => {
  if (getTargetLogImportRegex(targetLogName).test(content)) {
    return content;
  }

  const match = content.match(LOG_IMPORT_REGEX);
  if (!match) {
    return content;
  }

  const [fullMatch, imports, importPath] = match;
  const importList = imports.split(',').map((s) => s.trim());

  if (!importList.includes(targetLogName)) {
    importList.push(targetLogName);
  }

  let tempContent = content;
  for (const { pattern, replacement } of replacements) {
    tempContent = tempContent.replace(pattern, replacement);
  }

  tempContent = tempContent.replace(LOG_IMPORT_REGEX, '');

  if (!/\bLog\b/.test(tempContent)) {
    const logIndex = importList.indexOf('Log');
    if (logIndex > -1) {
      importList.splice(logIndex, 1);
    }
  }

  return content.replace(
    fullMatch,
    `import { ${importList.join(', ')} } from ${importPath}`,
  );
};

export const migrateLogContent = (
  content: string,
  targetLogName: string,
): MigrationResult => {
  const replacements = createReplacements(targetLogName);
  let nextContent = content;
  let changeCount = 0;

  for (const { pattern, replacement } of replacements) {
    const matches = nextContent.match(pattern);
    if (matches) {
      changeCount += matches.length;
      nextContent = nextContent.replace(pattern, replacement);
    }
  }

  if (changeCount > 0) {
    nextContent = updateImports(nextContent, targetLogName, replacements);
  }

  return {
    content: nextContent,
    changes: changeCount,
  };
};

export const migrateLogFile = (
  filePath: string,
  targetLogName: string,
  dryRun: boolean = false,
): FileMigrationResult => {
  try {
    const originalContent = fs.readFileSync(filePath, 'utf8');
    const { content, changes } = migrateLogContent(originalContent, targetLogName);
    const modified = content !== originalContent;

    if (modified && !dryRun) {
      fs.writeFileSync(filePath, content, 'utf8');
    }

    return { modified, changes };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return { modified: false, changes: 0 };
  }
};

export const runLogMigration = (config: LogMigrationConfig): void => {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`${config.description}\n`);
  if (dryRun) {
    console.log('Running in DRY RUN mode - no files will be modified\n');
  }

  const files = glob.sync(config.globPattern, {
    ignore: config.ignore || DEFAULT_IGNORE,
    absolute: true,
  });

  console.log(`Found ${files.length} ${config.fileLabel}\n`);

  const modifiedFiles: { path: string; changes: number }[] = [];
  let totalChanges = 0;

  for (const file of files) {
    const result = migrateLogFile(file, config.targetLogName, dryRun);
    if (result.modified) {
      modifiedFiles.push({ path: file, changes: result.changes });
      totalChanges += result.changes;
    }
  }

  console.log('\nMigration complete!\n');
  console.log(`Total changes: ${totalChanges}`);
  console.log(`${dryRun ? 'Would modify' : 'Modified'} ${modifiedFiles.length} files:\n`);

  modifiedFiles
    .sort((a, b) => b.changes - a.changes)
    .forEach(({ path: filePath, changes }) => {
      console.log(`  - ${path.relative(process.cwd(), filePath)} (${changes} changes)`);
    });

  if (modifiedFiles.length === 0) {
    console.log('  No files needed modification.');
  }
};
