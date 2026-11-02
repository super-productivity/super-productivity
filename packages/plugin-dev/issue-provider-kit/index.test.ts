import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asConfig,
  basicAuth,
  canConnect,
  isDoneMapping,
  pickSyncValues,
  t,
  textMapping,
  toMs,
  tokenAuth,
} from './index.ts';

const ctx = { issueId: '1' };
const host = globalThis as unknown as { PluginAPI?: unknown };

test('t translates and falls back to the key when translate throws', () => {
  host.PluginAPI = {
    translate: (key: string, params?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params ?? null)}`,
  };
  assert.equal(t('A'), 'A:null');
  assert.equal(t('A', { n: 1 }), 'A:{"n":1}');
  host.PluginAPI = {
    translate: () => {
      throw new Error('not ready');
    },
  };
  assert.equal(t('A'), 'A');
});

test('asConfig returns the same object', () => {
  const cfg = { host: 'x' };
  assert.equal(asConfig<{ host: string }>(cfg), cfg);
});

test('canConnect maps resolve/reject and honours isOk', async () => {
  assert.equal(await canConnect(async () => 'ok'), true);
  assert.equal(
    await canConnect(async () => {
      throw new Error('401');
    }),
    false,
  );
  assert.equal(await canConnect(async () => ({}), Array.isArray), false);
  assert.equal(await canConnect(async () => [], Array.isArray), true);
});

test('toMs parses ISO strings and returns 0 for empty values', () => {
  assert.equal(toMs('2024-01-02T03:04:05.000Z'), Date.UTC(2024, 0, 2, 3, 4, 5));
  assert.equal(toMs(''), 0);
  assert.equal(toMs(null), 0);
  assert.equal(toMs(undefined), 0);
  assert.equal(toMs(123), 0);
});

test('tokenAuth only sets a header with a token', () => {
  assert.deepEqual(tokenAuth('abc'), { Authorization: 'token abc' });
  assert.deepEqual(tokenAuth(''), {});
  assert.deepEqual(tokenAuth(undefined), {});
});

test('basicAuth matches btoa for ASCII and UTF-8 encodes the rest', () => {
  assert.equal(basicAuth('', 'pat123'), `Basic ${btoa(':pat123')}`);
  assert.equal(basicAuth('user', 'pw'), `Basic ${btoa('user:pw')}`);
  assert.equal(
    basicAuth('ü', '密'),
    `Basic ${Buffer.from('ü:密', 'utf8').toString('base64')}`,
  );
});

test('isDoneMapping defaults to state closed/open', () => {
  const m = isDoneMapping();
  assert.equal(m.taskField, 'isDone');
  assert.equal(m.issueField, 'state');
  assert.equal(m.defaultDirection, 'pullOnly');
  assert.equal(m.toIssueValue(true, ctx), 'closed');
  assert.equal(m.toIssueValue(false, ctx), 'open');
  assert.equal(m.toTaskValue('closed', ctx), true);
  assert.equal(m.toTaskValue('open', ctx), false);
});

test('isDoneMapping accepts custom values and predicate', () => {
  const m = isDoneMapping({ issueField: 'stateType', done: 'done', open: 'todo' });
  assert.equal(m.issueField, 'stateType');
  assert.equal(m.toIssueValue(true, ctx), 'done');
  assert.equal(m.toIssueValue(false, ctx), 'todo');
  assert.equal(m.toTaskValue('done', ctx), true);
  assert.equal(m.toTaskValue('closed', ctx), false);

  const custom = isDoneMapping({ isDone: (v) => v === 'x' || v === 'y' });
  assert.equal(custom.toTaskValue('y', ctx), true);
  assert.equal(custom.toTaskValue('closed', ctx), false);
});

test('textMapping passes strings through and defaults missing values to ""', () => {
  const m = textMapping('notes', 'body', 'off');
  assert.equal(m.taskField, 'notes');
  assert.equal(m.issueField, 'body');
  assert.equal(m.defaultDirection, 'off');
  assert.equal(m.toIssueValue('a', ctx), 'a');
  assert.equal(m.toIssueValue(undefined, ctx), '');
  assert.equal(m.toTaskValue(null, ctx), '');
  assert.equal(textMapping('title', 'title').defaultDirection, 'pullOnly');
});

test('pickSyncValues picks the listed fields in order', () => {
  const pick = pickSyncValues('state', 'title', 'body');
  const values = pick({ id: '1', title: 'T', state: 'open', extra: 1 });
  assert.deepEqual(values, { state: 'open', title: 'T', body: undefined });
  assert.deepEqual(Object.keys(values), ['state', 'title', 'body']);
});
