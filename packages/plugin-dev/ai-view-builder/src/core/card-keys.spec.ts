import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commandForKey, KeyCommand, KeyInput } from './card-keys';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyCommand | null =>
  commandForKey({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

const action = (a: string): KeyCommand => ({ type: 'action', action: a }) as KeyCommand;

describe('commandForKey', () => {
  it('maps the default task shortcuts of Super Productivity', () => {
    assert.deepEqual(key('Enter'), action('editTitle'));
    assert.deepEqual(key('d'), action('toggleDone'));
    assert.deepEqual(key('y'), action('toggleTrack'));
    assert.deepEqual(key('i'), action('open'));
    assert.deepEqual(key('t'), action('editEstimate'));
    assert.deepEqual(key('a'), action('addSubTask'));
    assert.deepEqual(key('Backspace'), action('delete'));
  });

  it('opens the menus', () => {
    assert.deepEqual(key('q'), { type: 'menu', view: 'main' });
    assert.deepEqual(key('ContextMenu'), { type: 'menu', view: 'main' });
    assert.deepEqual(key('F10', { shiftKey: true }), { type: 'menu', view: 'main' });
    assert.deepEqual(key('g'), { type: 'menu', view: 'tags' });
    assert.deepEqual(key('e'), { type: 'menu', view: 'project' });
  });

  it('moves focus and folds sub-tasks', () => {
    assert.deepEqual(key('ArrowUp'), { type: 'focus', direction: -1 });
    assert.deepEqual(key('k'), { type: 'focus', direction: -1 });
    assert.deepEqual(key('ArrowDown'), { type: 'focus', direction: 1 });
    assert.deepEqual(key('j'), { type: 'focus', direction: 1 });
    assert.deepEqual(key('ArrowLeft'), { type: 'collapse', collapsed: true });
    assert.deepEqual(key('ArrowRight'), { type: 'collapse', collapsed: false });
    assert.deepEqual(key('Escape'), { type: 'release' });
  });

  it('reads letters in either case', () => {
    assert.deepEqual(key('D'), action('toggleDone'));
  });

  it('adds a sub-task on Ctrl or Cmd with Enter', () => {
    assert.deepEqual(key('Enter', { ctrlKey: true }), action('addSubTask'));
    assert.deepEqual(key('Enter', { metaKey: true }), action('addSubTask'));
  });

  it('leaves Alt+Arrow to the board moves', () => {
    assert.equal(key('ArrowLeft', { altKey: true }), null);
    assert.equal(key('ArrowRight', { altKey: true }), null);
  });

  it('ignores browser and unmapped shortcuts', () => {
    assert.equal(key('d', { ctrlKey: true }), null);
    assert.equal(key('d', { metaKey: true }), null);
    assert.equal(key('d', { shiftKey: true }), null);
    assert.equal(key('Enter', { shiftKey: true }), null);
    assert.equal(key('x'), null);
    assert.equal(key('Tab'), null);
    assert.equal(key(' '), null);
  });
});
