const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const Module = require('node:module');

require('ts-node/register/transpile-only');
const originalLoad = Module._load;
let dialogResult;
let openResult;
let dialogCalls;
let opened;
let savePluginBinaryFile;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      dialog: {
        showSaveDialog: async (_window, options) => {
          dialogCalls.push(options);
          return dialogResult;
        },
      },
      shell: {
        openPath: async (value) => {
          opened.push(value);
          if (openResult instanceof Error) throw openResult;
          return openResult;
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
try {
  ({ savePluginBinaryFile } = require('./save-plugin-binary-file.ts'));
} finally {
  Module._load = originalLoad;
}

let root;
test.before(async () => {
  const tmp = path.resolve('.tmp');
  await fs.mkdir(tmp, { recursive: true });
  root = await fs.mkdtemp(path.join(tmp, 'binary-save-'));
});
test.beforeEach(() => {
  dialogCalls = [];
  opened = [];
  openResult = '';
  dialogResult = { canceled: true };
});
const bytes = Buffer.from([0, 255, 128, 10, 13, 0, 1]);
const request = (extra = {}) => ({
  filename: 'Документ с пробелом.pdf',
  data: Uint8Array.from(bytes).buffer,
  openAfterSave: true,
  ...extra,
});

test('Отмена ОС-диалога не сохраняет и не открывает файл', async () => {
  assert.deepEqual(await savePluginBinaryFile({}, request()), { kind: 'canceled' });
  assert.deepEqual(dialogCalls, [{ defaultPath: 'Документ с пробелом.pdf' }]);
  assert.deepEqual(opened, []);
});

test('Сохраняет исходные байты и открывает только путь текущего диалога', async () => {
  const selected = path.join(root, 'выбранное имя.pdf');
  dialogResult = { canceled: false, filePath: selected };
  assert.deepEqual(await savePluginBinaryFile({}, request()), {
    kind: 'saved',
    path: selected,
    openStatus: 'requested',
  });
  assert.deepEqual(await fs.readFile(selected), bytes);
  assert.deepEqual(opened, [selected]);
  assert.deepEqual(await savePluginBinaryFile({}, request({ openAfterSave: false })), {
    kind: 'saved',
    path: selected,
    openStatus: 'not-requested',
  });
  assert.equal(opened.length, 1);
});

test('Сохраняет ровно 10 МиБ без изменения байтов', async () => {
  const selected = path.join(root, 'предел.bin');
  const data = new Uint8Array(10 * 1024 * 1024).fill(129);
  dialogResult = { canceled: false, filePath: selected };
  assert.deepEqual(
    await savePluginBinaryFile(
      {},
      request({
        filename: 'предел.bin',
        data: data.buffer,
        openAfterSave: false,
      }),
    ),
    { kind: 'saved', path: selected, openStatus: 'not-requested' },
  );
  assert.deepEqual(await fs.readFile(selected), Buffer.from(data));
  assert.deepEqual(opened, []);
});

test('Нет ассоциации или отказ shell сохраняет файл и сообщает saved/failed', async () => {
  const selected = path.join(root, 'неизвестное расширение.unknown');
  dialogResult = { canceled: false, filePath: selected };
  for (const error of ['No association', new Error('OS rejected request')]) {
    openResult = error;
    assert.deepEqual(await savePluginBinaryFile({}, request()), {
      kind: 'saved',
      path: selected,
      openStatus: 'failed',
    });
    assert.deepEqual(await fs.readFile(selected), bytes);
  }
});

test('Ошибка записи не вызывает открытие и не раскрывает путь', async () => {
  dialogResult = {
    canceled: false,
    filePath: path.join(root, 'нет каталога', 'файл.pdf'),
  };
  await assert.rejects(savePluginBinaryFile({}, request()), {
    message: 'Could not save binary file',
  });
  assert.deepEqual(opened, []);
});

test('Смена расширения в диалоге на EXE сохраняет, но блокирует открытие', async () => {
  const selected = path.join(root, 'выбранное имя.exe');
  dialogResult = { canceled: false, filePath: selected };
  assert.deepEqual(await savePluginBinaryFile({}, request()), {
    kind: 'saved',
    path: selected,
    openStatus: 'blocked',
  });
  assert.deepEqual(await fs.readFile(selected), bytes);
  assert.deepEqual(opened, []);
  dialogResult = { canceled: false, filePath: '\\\\host\\share\\file.pdf' };
  await assert.rejects(savePluginBinaryFile({}, request()), /Unsupported save location/);
  assert.deepEqual(opened, []);
});

test('Проверяет двоичный payload, предел и отсутствие произвольного пути до диалога', async () => {
  const invalid = [
    { filename: '../file.pdf' },
    { filename: 'C:\\file.pdf' },
    { filename: 'file.pdf\n' },
    { filename: '..' },
    { filename: 'file.exe. ' },
    { filename: '' },
    { path: path.join(root, 'чужой файл.pdf') },
    { data: 'not binary' },
    { data: new ArrayBuffer(10 * 1024 * 1024 + 1) },
    { openAfterSave: 'true' },
  ];
  for (const value of invalid)
    await assert.rejects(
      savePluginBinaryFile({}, request(value)),
      /Invalid binary file request/,
    );
  assert.equal(dialogCalls.length, 0);
  assert.deepEqual(
    await savePluginBinaryFile(
      {},
      request({ filename: '.env', data: new ArrayBuffer(0) }),
    ),
    { kind: 'canceled' },
  );
});

test('Имя из одного исполняемого расширения не открывается', async () => {
  for (const name of ['.cmd', '.exe', '.ps1']) {
    const selected = path.join(root, name);
    dialogResult = { canceled: false, filePath: selected };
    assert.equal(
      (await savePluginBinaryFile({}, request({ filename: name }))).openStatus,
      'blocked',
    );
    assert.deepEqual(await fs.readFile(selected), bytes);
  }
  assert.deepEqual(opened, []);
});

test('Незавершённый диалог блокирует второй; байты копируются до ожидания', async () => {
  let finish;
  dialogResult = new Promise((resolve) => {
    finish = resolve;
  });
  const input = request();
  const first = savePluginBinaryFile({}, input);
  new Uint8Array(input.data).fill(42);
  await assert.rejects(savePluginBinaryFile({}, request()), /already pending/);
  assert.equal(dialogCalls.length, 1);
  const selected = path.join(root, 'после ожидания.pdf');
  finish({ canceled: false, filePath: selected });
  assert.equal((await first).openStatus, 'requested');
  assert.deepEqual(await fs.readFile(selected), bytes);
  dialogResult = { canceled: true };
  assert.equal((await savePluginBinaryFile({}, request())).kind, 'canceled');
});
