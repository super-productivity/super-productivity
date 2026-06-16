const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const fsModule = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
let userDataDir;

const modulePath = path.resolve(__dirname, 'image-cache.ts');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => userDataDir },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const reset = () => {
  delete require.cache[modulePath];
};

const load = () => {
  reset();
  return require(modulePath);
};

test.beforeEach(async () => {
  userDataDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-img-cache-')),
  );
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  reset();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

const mkPng = async (dir, name = 'bg.png', bytes = Buffer.from('fakepngdata')) => {
  const p = path.join(dir, name);
  await fs.writeFile(p, bytes);
  return p;
};

test('importImage copies a valid image and returns an opaque id', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = await mkPng(sourceDir);
    const result = await cache.importImage(src);
    assert.ok(result);
    assert.match(result.id, /^[a-f0-9]{32}$/);
    assert.equal(result.mimeType, 'image/png');
    const cached = path.join(userDataDir, 'bg-images', `${result.id}.png`);
    assert.equal(fsModule.existsSync(cached), true);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage accepts avif and bmp (restored legacy formats)', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const avif = await mkPng(sourceDir, 'bg.avif', Buffer.from('fakeavif'));
    const avifResult = await cache.importImage(avif);
    assert.ok(avifResult);
    assert.equal(avifResult.mimeType, 'image/avif');

    const bmp = await mkPng(sourceDir, 'bg.bmp', Buffer.from('fakebmp'));
    const bmpResult = await cache.importImage(bmp);
    assert.ok(bmpResult);
    assert.equal(bmpResult.mimeType, 'image/bmp');
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage rejects svg (scriptable format deliberately excluded)', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const svg = await mkPng(sourceDir, 'bg.svg', Buffer.from('<svg></svg>'));
    assert.equal(await cache.importImage(svg), null);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage returns null for a path inside userData (no laundering)', async () => {
  const cache = load();
  const evilPath = await mkPng(userDataDir, 'planted.png');
  const result = await cache.importImage(evilPath);
  assert.equal(result, null);
});

test('importImage returns null for an unsupported extension', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = path.join(sourceDir, 'bad.txt');
    await fs.writeFile(src, 'hello');
    const result = await cache.importImage(src);
    assert.equal(result, null);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage returns null for a file over MAX_IMAGE_BYTES', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    // 6 MB > 5 MB cap
    const huge = Buffer.alloc(6 * 1024 * 1024, 0xaa);
    const src = await mkPng(sourceDir, 'big.png', huge);
    const result = await cache.importImage(src);
    assert.equal(result, null);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage returns null for an empty file', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = path.join(sourceDir, 'empty.png');
    await fs.writeFile(src, '');
    const result = await cache.importImage(src);
    assert.equal(result, null);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('importImage returns null for a non-existent source', async () => {
  const cache = load();
  const result = await cache.importImage('/does/not/exist/bg.png');
  assert.equal(result, null);
});

test('importImage returns null for a non-string input (fail-closed)', async () => {
  const cache = load();
  assert.equal(await cache.importImage(undefined), null);
  assert.equal(await cache.importImage(null), null);
  assert.equal(await cache.importImage(42), null);
  assert.equal(await cache.importImage(''), null);
});

test('getImageDataUrl returns the data url for a known id', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = await mkPng(sourceDir, 'bg.png', Buffer.from('imgbytes'));
    const imported = await cache.importImage(src);
    assert.ok(imported);
    const url = await cache.getImageDataUrl(imported.id);
    assert.match(url, /^data:image\/png;base64,/);
    const base64 = url.split(',')[1];
    assert.equal(Buffer.from(base64, 'base64').toString('utf8'), 'imgbytes');
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('getImageDataUrl returns null for unknown / malformed ids', async () => {
  const cache = load();
  assert.equal(await cache.getImageDataUrl('not-hex'), null);
  assert.equal(await cache.getImageDataUrl(''), null);
  // Right shape but never imported:
  assert.equal(await cache.getImageDataUrl('a'.repeat(32)), null);
});

test('getImageDataUrl resolves across module reloads (persistence)', async () => {
  let cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = await mkPng(sourceDir);
    const imported = await cache.importImage(src);
    assert.ok(imported);
    cache = load(); // simulate app restart
    const url = await cache.getImageDataUrl(imported.id);
    assert.match(url, /^data:image\/png;base64,/);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('removeCachedImage deletes the file; subsequent getDataUrl is null', async () => {
  const cache = load();
  const sourceDir = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-src-')),
  );
  try {
    const src = await mkPng(sourceDir);
    const imported = await cache.importImage(src);
    assert.ok(imported);
    await cache.removeCachedImage(imported.id);
    assert.equal(await cache.getImageDataUrl(imported.id), null);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
});

test('removeCachedImage is a no-op for unknown ids', async () => {
  const cache = load();
  await cache.removeCachedImage('a'.repeat(32));
  await cache.removeCachedImage('not-a-valid-id');
  // No throw == pass.
});
