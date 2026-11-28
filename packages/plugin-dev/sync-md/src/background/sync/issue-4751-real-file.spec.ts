/** @jest-environment node */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskBuilder } from '../__tests__/test-utils';
import { readTasksFile } from '../helper/file-utils';
import { parseMarkdownWithHeader } from './markdown-parser';
import { mdToSp } from './md-to-sp';
import { spToMd } from './sp-to-md';

const HEADER = 'MyProject\n\n';
const FOOTER = [
  '<!-- Local Variables: -->',
  '<!-- backup-inhibited: t -->',
  '<!-- auto-save-default: nil -->',
  '<!-- End: -->',
].join('\n');
const TASK_LINE = '- [ ] <!--task-1--> Original task';

/**
 * Real local-file provider reproduction for #4751. The filesystem helpers and
 * their Node scripts run unchanged. Only app-owned task/project reads and the
 * Electron transport are supplied at the PluginAPI boundary. This does not
 * simulate batch reducers or claim to exercise the Electron watcher lifecycle.
 */
describe('#4751 real-file Markdown preservation', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    PluginAPI.batchUpdateForProject = jest.fn().mockResolvedValue({ success: true });
    directory = mkdtempSync(join(tmpdir(), 'sp-4751-'));
    filePath = join(directory, 'joplin-edit.md');
    jest.spyOn(PluginAPI, 'executeNodeScript').mockImplementation(async (request) => {
      // Execute only scripts supplied by the repository's real file helpers.
      const run = new Function('require', 'args', request.script);
      return { success: true, result: run(require, request.args) as unknown };
    });
    jest
      .spyOn(PluginAPI, 'getTasks')
      .mockResolvedValue([
        new TaskBuilder()
          .withId('task-1')
          .withTitle('Renamed task')
          .withProjectId('test-project')
          .build(),
      ]);
    jest
      .spyOn(PluginAPI, 'getAllProjects')
      .mockResolvedValue([
        { id: 'test-project', title: 'FromJOPLIN', taskIds: ['task-1'] },
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('preserves the exact Joplin header bytes when exporting an SP edit', async () => {
    writeFileSync(filePath, HEADER + TASK_LINE, 'utf8');

    await spToMd({ filePath, projectId: 'test-project' });

    expect(readFileSync(filePath, 'utf8')).toBe(
      HEADER + '- [ ] <!--task-1--> Renamed task',
    );
  });

  it('preserves the exact footer bytes when exporting an SP edit', async () => {
    writeFileSync(filePath, HEADER + TASK_LINE + '\n' + FOOTER, 'utf8');

    await spToMd({ filePath, projectId: 'test-project' });

    expect(readFileSync(filePath, 'utf8')).toBe(
      HEADER + '- [ ] <!--task-1--> Renamed task\n' + FOOTER,
    );
  });

  it.each(['', ' ', '  '])(
    'retains note characters with %j indentation',
    async (indent) => {
      writeFileSync(filePath, TASK_LINE + '\n' + indent + 'Keep this prose');
      const parsed = parseMarkdownWithHeader((await readTasksFile(filePath))!);
      expect(parsed.tasks[0].notes).toBe('Keep this prose');
    },
  );

  it.each(['\n', '\r\n'])(
    'preserves footer bytes and task notes across repeated import/export (%j)',
    async (newline) => {
      const notes = 'Ordinary note\n<!-- task note -->';
      const suffix =
        newline + newline + FOOTER.replace(/\n/g, newline) + newline + newline;
      writeFileSync(
        filePath,
        HEADER +
          TASK_LINE +
          newline +
          '  Ordinary note' +
          newline +
          '  <!-- task note -->' +
          suffix,
      );
      const task = new TaskBuilder()
        .withId('task-1')
        .withTitle('Original task')
        .withProjectId('test-project')
        .build();
      // Representative app snapshot, not a fake implementation of app reducers.
      jest.spyOn(PluginAPI, 'getTasks').mockResolvedValue([{ ...task, notes }]);
      const batch = jest.spyOn(PluginAPI, 'batchUpdateForProject');
      for (let cycle = 0; cycle < 3; cycle++) {
        const content = (await readTasksFile(filePath))!;
        expect(parseMarkdownWithHeader(content).tasks[0].notes).toBe(notes);
        await mdToSp(content, 'test-project');
        expect(batch).toHaveBeenLastCalledWith({
          projectId: 'test-project',
          operations: [{ type: 'reorder', taskIds: ['task-1'] }],
        });
        await spToMd({ filePath, projectId: 'test-project' });
        expect(readFileSync(filePath, 'utf8')).toBe(
          HEADER + TASK_LINE + '\n  Ordinary note\n  <!-- task note -->' + suffix,
        );
      }
    },
  );

  it('keeps a final indented HTML comment as task notes', () => {
    expect(
      parseMarkdownWithHeader(TASK_LINE + '\n  <!-- task note -->').tasks[0].notes,
    ).toBe('<!-- task note -->');
  });

  it('keeps non-trailing comments and unclosed comments in task notes', () => {
    for (const notes of [
      '<!-- note -->\nMore prose',
      '<!-- unclosed',
      '  <!-- outer\n<!-- inner -->',
    ]) {
      expect(parseMarkdownWithHeader(TASK_LINE + '\n' + notes).tasks[0].notes).toBe(
        notes.replace(/^  /, ''),
      );
    }
  });

  it('preserves a multiline footer without importing its checklist as tasks', async () => {
    const suffix = '\n\n<!-- Footer\n- [ ] Not a task\n-->\n';
    writeFileSync(filePath, TASK_LINE + suffix);
    const parsed = parseMarkdownWithHeader((await readTasksFile(filePath))!);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].notes).toBeUndefined();
    await spToMd({ filePath, projectId: 'test-project' });
    expect(readFileSync(filePath, 'utf8')).toBe(
      '- [ ] <!--task-1--> Renamed task' + suffix,
    );
  });

  it.each([
    ['```html', '<!-- literal opener', '```'],
    ['~~~html', '<!-- literal opener', '~~~'],
    ['````html', '```\n<!-- literal opener', '````'],
    ['```html', '<!-- literal opener', '````'],
    ['Example `<!--` marker', '', ''],
    ['Example ``literal ` and <!--`` marker', '', ''],
  ])('keeps %s code delimiters from consuming the footer', async (open, body, close) => {
    const notes = [open, body, close].filter(Boolean).join('\n');
    const suffix = '\n\n' + FOOTER + '\n';
    const content =
      HEADER +
      TASK_LINE +
      '\n' +
      notes
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n') +
      suffix;
    writeFileSync(filePath, content);
    const task = new TaskBuilder()
      .withId('task-1')
      .withTitle('Original task')
      .withProjectId('test-project')
      .build();
    jest.spyOn(PluginAPI, 'getTasks').mockResolvedValue([{ ...task, notes }]);
    const batch = jest.spyOn(PluginAPI, 'batchUpdateForProject');
    for (let cycle = 0; cycle < 3; cycle++) {
      const current = (await readTasksFile(filePath))!;
      expect(parseMarkdownWithHeader(current).tasks[0].notes).toBe(notes);
      await mdToSp(current, 'test-project');
      expect(batch).toHaveBeenLastCalledWith({
        projectId: 'test-project',
        operations: [{ type: 'reorder', taskIds: ['task-1'] }],
      });
      await spToMd({ filePath, projectId: 'test-project' });
      expect(readFileSync(filePath, 'utf8')).toBe(content);
    }
  });

  it.each(['\n', '\n\n'])(
    'does not pair unmatched backticks with a footer after %j',
    async (separator) => {
      const notes = 'An unmatched ` delimiter';
      const suffix = separator + '<!-- Footer ` example -->';
      writeFileSync(filePath, TASK_LINE + '\n  ' + notes + suffix);
      const parsed = parseMarkdownWithHeader((await readTasksFile(filePath))!);
      expect(parsed.tasks[0].notes).toBe(notes);
      expect(parsed.footer).toBe(suffix);
      const task = new TaskBuilder()
        .withId('task-1')
        .withTitle('Renamed task')
        .withProjectId('test-project')
        .build();
      jest.spyOn(PluginAPI, 'getTasks').mockResolvedValue([{ ...task, notes }]);
      await spToMd({ filePath, projectId: 'test-project' });
      expect(readFileSync(filePath, 'utf8')).toBe(
        '- [ ] <!--task-1--> Renamed task\n  ' + notes + suffix,
      );
    },
  );

  it('does not treat unmatched backticks as a code span', () => {
    const notes = 'An unmatched ` delimiter';
    const parsed = parseMarkdownWithHeader(TASK_LINE + '\n  ' + notes + '\n\n' + FOOTER);
    expect(parsed.tasks[0].notes).toBe(notes);
    expect(parsed.footer).toBe('\n\n' + FOOTER);
  });

  it('keeps trailing comments inside an unclosed code fence in task notes', () => {
    const content = TASK_LINE + '\n  ```html\n<!-- literal -->';
    const parsed = parseMarkdownWithHeader(content);
    expect(parsed.footer).toBeUndefined();
    expect(parsed.tasks[0].notes).toBe('```html\n<!-- literal -->');
  });

  it('keeps apparent code fences inside a multiline footer comment', async () => {
    const suffix = '\n\n<!-- Footer\n```html\n- [ ] Not a task\n```\n-->\n';
    writeFileSync(filePath, TASK_LINE + suffix);
    const parsed = parseMarkdownWithHeader((await readTasksFile(filePath))!);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].notes).toBeUndefined();
    await spToMd({ filePath, projectId: 'test-project' });
    expect(readFileSync(filePath, 'utf8')).toBe(
      '- [ ] <!--task-1--> Renamed task' + suffix,
    );
  });

  it('keeps an initially empty Joplin document stable before adding tasks', async () => {
    writeFileSync(filePath, HEADER + FOOTER);
    jest.spyOn(PluginAPI, 'getTasks').mockResolvedValue([]);
    for (let cycle = 0; cycle < 3; cycle++) {
      await spToMd({ filePath, projectId: 'test-project' });
      expect(readFileSync(filePath, 'utf8')).toBe(HEADER + FOOTER);
    }
  });

  it.each(['\n', '\r\n'])(
    'preserves the Joplin header and footer after removing all tasks and adding again (%j)',
    async (newline) => {
      const header = HEADER.replace(/\n/g, newline);
      const suffix = newline + newline + FOOTER.replace(/\n/g, newline) + newline;
      writeFileSync(filePath, header + TASK_LINE + suffix);
      jest.spyOn(PluginAPI, 'getTasks').mockResolvedValue([]);
      await spToMd({ filePath, projectId: 'test-project' });
      const emptyContent = readFileSync(filePath, 'utf8');
      expect(emptyContent).toBe(header + suffix);
      await spToMd({ filePath, projectId: 'test-project' });
      expect(readFileSync(filePath, 'utf8')).toBe(emptyContent);
      jest
        .spyOn(PluginAPI, 'getTasks')
        .mockResolvedValue([
          new TaskBuilder()
            .withId('task-1')
            .withTitle('New task')
            .withProjectId('test-project')
            .build(),
        ]);
      await spToMd({ filePath, projectId: 'test-project' });
      const restoredContent = readFileSync(filePath, 'utf8');
      expect(restoredContent).toBe(header + '- [ ] <!--task-1--> New task' + suffix);
      await spToMd({ filePath, projectId: 'test-project' });
      expect(readFileSync(filePath, 'utf8')).toBe(restoredContent);
    },
  );
});
