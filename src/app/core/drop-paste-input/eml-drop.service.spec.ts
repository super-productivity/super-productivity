import { TestBed } from '@angular/core/testing';
import { EmlDropService } from './eml-drop.service';
import { TaskService } from '../../features/tasks/task.service';
import { SnackService } from '../snack/snack.service';
import { Log } from '../log';
import { T } from '../../t.const';

const makeFile = (content: string, name = 'mail.eml'): File =>
  new File([content], name, { type: '' });

const VALID_EML = [
  'From: Alice Example <alice@example.com>',
  'Subject: Hello World',
  '',
  'body',
  '',
].join('\n');

const NO_SUBJECT_EML = ['From: Alice Example <alice@example.com>', '', 'body', ''].join(
  '\n',
);

const NO_FROM_EML = ['Subject: Hello World', '', 'body', ''].join('\n');

const EMPTY_EML = ['', 'body', ''].join('\n');

describe('EmlDropService', () => {
  let service: EmlDropService;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', ['add']);
    snackService = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        EmlDropService,
        { provide: TaskService, useValue: taskService },
        { provide: SnackService, useValue: snackService },
      ],
    });

    service = TestBed.inject(EmlDropService);
  });

  it('should add a task titled "sender: subject" for a valid eml, ignoring short syntax', async () => {
    await service.createTaskFromEml(makeFile(VALID_EML));

    // 5th arg `true` = isIgnoreShortSyntax: email subjects are untrusted and must
    // not have #tag/@date/+project tokens parsed out of the title.
    expect(taskService.add).toHaveBeenCalledWith(
      'Alice Example: Hello World',
      false,
      { notes: '```\nbody\n```' },
      false,
      true,
    );
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('should not add a leading ": " when there is no sender', async () => {
    await service.createTaskFromEml(makeFile(NO_FROM_EML));

    expect(taskService.add).toHaveBeenCalledWith(
      'Hello World',
      false,
      { notes: '```\nbody\n```' },
      false,
      true,
    );
  });

  it('should not add a trailing ": " when there is no subject', async () => {
    await service.createTaskFromEml(makeFile(NO_SUBJECT_EML));

    expect(taskService.add).toHaveBeenCalledWith(
      'Alice Example',
      false,
      { notes: '```\nbody\n```' },
      false,
      true,
    );
  });

  it('should leave notes undefined when the email has no body', async () => {
    const noBodyEml = ['From: Alice <alice@example.com>', 'Subject: Hi', '', ''].join(
      '\n',
    );

    await service.createTaskFromEml(makeFile(noBodyEml));

    expect(taskService.add).toHaveBeenCalledWith(
      'Alice: Hi',
      false,
      { notes: undefined },
      false,
      true,
    );
  });

  it('should create a title-only task when the body encoding is unsupported', async () => {
    const encodedEml = [
      'From: Alice <alice@example.com>',
      'Subject: Encoded',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      'Ym9keQ==',
      '',
    ].join('\n');

    await service.createTaskFromEml(makeFile(encodedEml));

    expect(taskService.add).toHaveBeenCalledWith(
      'Alice: Encoded',
      false,
      { notes: undefined },
      false,
      true,
    );
  });

  it('should store imported plain text literally so remote content stays inert', async () => {
    const remoteImageEml = [
      'From: Alice <alice@example.com>',
      'Subject: Remote image',
      '',
      '![pixel](https://attacker.example/pixel)',
      '\\![already escaped](https://attacker.example/pixel)',
      '![reference image][pixel]',
      '[pixel]: https://attacker.example/pixel',
      '`C:\\tmp`',
      '<strong>ordinary markup</strong>',
      '<img src="https://attacker.example/pixel">',
      '```',
      '',
    ].join('\n');

    await service.createTaskFromEml(makeFile(remoteImageEml));

    expect(taskService.add).toHaveBeenCalledWith(
      'Alice: Remote image',
      false,
      {
        notes:
          '~~~\n' +
          '![pixel](https://attacker.example/pixel)\n' +
          '\\![already escaped](https://attacker.example/pixel)\n' +
          '![reference image][pixel]\n' +
          '[pixel]: https://attacker.example/pixel\n' +
          '`C:\\tmp`\n' +
          '<strong>ordinary markup</strong>\n' +
          '<img src="https://attacker.example/pixel">\n' +
          '```\n' +
          '~~~',
      },
      false,
      true,
    );
  });

  it('should not parse a valid eml or add a task when the file exceeds the size limit', async () => {
    const bigFile = makeFile(VALID_EML);
    // Report an oversized file without allocating 10MB.
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });

    await service.createTaskFromEml(bigFile);

    expect(taskService.add).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.MH.EML_TOO_LARGE,
    });
  });

  it('should cap an oversized body so the synced note stays bounded', async () => {
    const maxBodyLength = 100_000;
    const longBody = 'a'.repeat(maxBodyLength + 50);
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: Long',
      '',
      longBody,
      '',
    ].join('\n');

    await service.createTaskFromEml(makeFile(eml));

    const notes = taskService.add.calls.mostRecent().args[2]?.notes;
    expect(notes).toBe('```\n' + 'a'.repeat(maxBodyLength) + '…\n```');
  });

  it('should cap an oversized title', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: ' + 'S'.repeat(350),
      '',
      'body',
      '',
    ].join('\n');

    await service.createTaskFromEml(makeFile(eml));

    const title = taskService.add.calls.mostRecent().args[0];
    expect(title).toBe('Alice: ' + 'S'.repeat(293) + '…');
    expect(title?.length).toBe(301);
  });

  it('should show a warning snack and not add a task when both sender and subject are empty', async () => {
    await service.createTaskFromEml(makeFile(EMPTY_EML));

    expect(taskService.add).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      type: 'WARNING',
      msg: T.MH.EML_EMPTY,
    });
  });

  it('should log and show an error snack without adding a task when parsing fails', async () => {
    const logErrSpy = spyOn(Log, 'err');
    const file = makeFile(VALID_EML);
    spyOn(file, 'text').and.rejectWith(new Error('read failed'));

    await service.createTaskFromEml(file);

    expect(taskService.add).not.toHaveBeenCalled();
    expect(logErrSpy).toHaveBeenCalledOnceWith('Failed to parse EML file');
    expect(snackService.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.MH.EML_PARSE_ERROR,
    });
  });
});
