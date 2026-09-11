import { TestBed } from '@angular/core/testing';
import { TaskMultiSelectService } from './task-multi-select.service';

describe('TaskMultiSelectService', () => {
  let service: TaskMultiSelectService;
  let root: HTMLElement;

  const buildDom = (): void => {
    root = document.createElement('div');
    root.innerHTML = `
      <div class="task-list-inner" data-list-id="PARENT">
        <task data-task-id="a" tabindex="0"></task>
        <task data-task-id="b" tabindex="0">
          <div class="sub-tasks">
            <div class="task-list-inner" data-list-id="SUB">
              <task data-task-id="b1" tabindex="0"></task>
              <task data-task-id="b2" tabindex="0"></task>
            </div>
          </div>
        </task>
        <task data-task-id="c" tabindex="0"></task>
        <task data-task-id="d" tabindex="0"></task>
      </div>
      <div class="task-list-inner" data-list-id="DONE">
        <task data-task-id="e" tabindex="0"></task>
      </div>
      <task-detail-panel>
        <div class="task-list-inner" data-list-id="SUB">
          <task data-task-id="b1" tabindex="0"></task>
        </div>
      </task-detail-panel>
    `;
    document.body.appendChild(root);
  };

  // Headless Chrome only updates document.activeElement when the test iframe
  // has window focus, so stub it the way task-shortcut.service.spec.ts does.
  let activeElementStubbed = false;
  const stubActiveElement = (el: Element | null): void => {
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => el,
    });
    activeElementStubbed = true;
  };

  const focusRow = (id: string): void => {
    stubActiveElement(root.querySelector(`task[data-task-id="${id}"]`));
  };

  const extend = (direction: 'up' | 'down'): HTMLElement | null => {
    const el = service.extendFromFocused(direction);
    if (el) {
      stubActiveElement(el);
    }
    return el;
  };

  const selected = (): string[] => Array.from(service.selectedIds()).sort();

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TaskMultiSelectService] });
    service = TestBed.inject(TaskMultiSelectService);
    buildDom();
  });

  afterEach(() => {
    root.remove();
    if (activeElementStubbed) {
      delete (document as unknown as { activeElement?: unknown }).activeElement;
      activeElementStubbed = false;
    }
  });

  it('starts empty', () => {
    expect(service.count()).toBe(0);
    expect(service.isActive()).toBeFalse();
    expect(service.anchorId()).toBeNull();
  });

  describe('toggle', () => {
    it('adds and removes ids and tracks the anchor', () => {
      service.toggle('a');
      service.toggle('c');
      expect(selected()).toEqual(['a', 'c']);
      expect(service.anchorId()).toBe('c');

      service.toggle('c');
      expect(selected()).toEqual(['a']);
      // a deselected row is no anchor for the next Shift+click
      expect(service.anchorId()).toBeNull();

      service.toggle('c');
      service.toggle('a');
      expect(selected()).toEqual(['c']);
      // deselecting another row keeps the anchor
      expect(service.anchorId()).toBe('c');

      service.toggle('c');
      expect(selected()).toEqual([]);
      expect(service.anchorId()).toBeNull();
    });
  });

  describe('selectRange', () => {
    it('selects the target alone when there is no anchor', () => {
      service.selectRange('c');
      expect(selected()).toEqual(['c']);
      expect(service.anchorId()).toBe('c');
    });

    it('selects direct rows between anchor and target, skipping nested subtasks', () => {
      service.toggle('a');
      service.selectRange('d');
      expect(selected()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('works upwards and replaces the previous range', () => {
      service.toggle('c');
      service.selectRange('d');
      expect(selected()).toEqual(['c', 'd']);
      service.selectRange('a');
      expect(selected()).toEqual(['a', 'b', 'c']);
      expect(service.anchorId()).toBe('c');
    });

    it('keeps the existing selection when additive', () => {
      service.toggle('a');
      service.toggle('d');
      service.selectRange('b', true);
      // range d..b is [b, c, d]; a survives because the range is additive
      expect(selected()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('re-anchors when the target is in another list', () => {
      service.toggle('a');
      service.selectRange('e');
      expect(selected()).toEqual(['e']);
      expect(service.anchorId()).toBe('e');
    });

    it('ranges inside a subtask list when the anchor is a subtask', () => {
      service.toggle('b1');
      service.selectRange('b2');
      expect(selected()).toEqual(['b1', 'b2']);
    });
  });

  describe('extendFromFocused', () => {
    it('starts from the focused row and extends downwards', () => {
      focusRow('b');
      const el = extend('down');
      expect(el?.getAttribute('data-task-id')).toBe('c');
      expect(selected()).toEqual(['b', 'c']);
      expect(service.anchorId()).toBe('b');
    });

    it('shrinks when moving back towards the anchor', () => {
      focusRow('b');
      extend('down');
      extend('down');
      expect(selected()).toEqual(['b', 'c', 'd']);
      extend('up');
      expect(selected()).toEqual(['b', 'c']);
    });

    it('returns null at the list edge and keeps the selection', () => {
      focusRow('d');
      expect(extend('down')).toBeNull();
      expect(selected()).toEqual(['d']);
    });

    it('does nothing without a focused row', () => {
      stubActiveElement(document.body);
      expect(service.extendFromFocused('down')).toBeNull();
      expect(service.count()).toBe(0);
    });
  });

  describe('selectAllInListOfFocused', () => {
    it('selects the direct rows of the focused list only', () => {
      focusRow('c');
      service.selectAllInListOfFocused();
      expect(selected()).toEqual(['a', 'b', 'c', 'd']);
      expect(service.anchorId()).toBe('c');
    });

    it('ignores a focused row inside the detail panel', () => {
      stubActiveElement(root.querySelector('task-detail-panel task'));
      service.selectAllInListOfFocused();
      expect(service.extendFromFocused('down')).toBeNull();
      expect(service.count()).toBe(0);
    });

    it('selects sibling subtasks when a subtask is focused', () => {
      focusRow('b2');
      service.selectAllInListOfFocused();
      expect(selected()).toEqual(['b1', 'b2']);
    });
  });

  describe('selectedIdsInDomOrder', () => {
    it('returns visual order, ignoring detail-panel copies', () => {
      service.toggle('d');
      service.toggle('b1');
      service.toggle('a');
      expect(service.selectedIdsInDomOrder()).toEqual(['a', 'b1', 'd']);
    });

    it('appends ids that have no rendered row', () => {
      service.toggle('c');
      service.toggle('gone');
      expect(service.selectedIdsInDomOrder()).toEqual(['c', 'gone']);
    });
  });

  describe('touch selection mode', () => {
    it('enters with the initial task selected', () => {
      service.enterTouchSelectionMode('a');
      expect(service.isTouchSelectionMode()).toBeTrue();
      expect(selected()).toEqual(['a']);
      expect(service.isSelecting()).toBeTrue();
    });

    it('ends when the last task is deselected', () => {
      service.enterTouchSelectionMode('a');
      service.toggle('b');
      service.toggle('a');
      expect(service.isTouchSelectionMode()).toBeTrue();
      service.toggle('b');
      expect(service.isTouchSelectionMode()).toBeFalse();
      expect(service.isSelecting()).toBeFalse();
    });

    it('ends when the last task is removed or pruned away', () => {
      service.enterTouchSelectionMode('a');
      service.remove('a');
      expect(service.isTouchSelectionMode()).toBeFalse();

      service.enterTouchSelectionMode('b');
      service.prune(new Set(['x']));
      expect(service.isTouchSelectionMode()).toBeFalse();
    });

    it('clear leaves the mode', () => {
      service.enterTouchSelectionMode('a');
      service.clear();
      expect(service.isTouchSelectionMode()).toBeFalse();
      expect(service.isSelecting()).toBeFalse();
    });
  });

  describe('remove / prune / clear', () => {
    it('remove drops one id and resets a removed anchor', () => {
      service.toggle('a');
      service.toggle('b');
      service.remove('b');
      expect(selected()).toEqual(['a']);
      expect(service.anchorId()).toBeNull();
    });

    const rowEl = (id: string): HTMLElement =>
      root.querySelector(`task[data-task-id="${id}"]`) as HTMLElement;

    it('removeWhenUnrendered keeps an id when another row still renders it', async () => {
      // A detail-panel copy of b1 is destroyed; the main-list row stays.
      service.toggle('b1');
      service.removeWhenUnrendered(
        'b1',
        root.querySelector('task-detail-panel task') as HTMLElement,
      );
      await new Promise((resolve) => setTimeout(resolve));
      expect(selected()).toEqual(['b1']);
    });

    it('removeWhenUnrendered drops an id whose row is gone', async () => {
      service.toggle('a');
      const el = rowEl('a');
      el.remove();
      service.removeWhenUnrendered('a', el);
      await new Promise((resolve) => setTimeout(resolve));
      expect(selected()).toEqual([]);
    });

    it('removeWhenUnrendered ignores the destroyed host still in the DOM (leave animation)', async () => {
      service.toggle('a');
      service.removeWhenUnrendered('a', rowEl('a'));
      await new Promise((resolve) => setTimeout(resolve));
      expect(selected()).toEqual([]);
    });

    it('a destroyed host is no live row, even when not selected', () => {
      const el = rowEl('c');
      expect(service.findLiveRowEl('c')).toBe(el);
      service.removeWhenUnrendered('c', el);
      expect(service.isDestroyedHost(el)).toBeTrue();
      expect(service.findLiveRowEl('c')).toBeNull();
      expect(service.selectedIdsInDomOrder()).toEqual([]);
    });

    it('bulk feedback suppression is off by default and settable', () => {
      expect(service.isBulkFeedbackSuppressed()).toBeFalse();
      service.setBulkFeedbackSuppressed(true);
      expect(service.isBulkFeedbackSuppressed()).toBeTrue();
      service.setBulkFeedbackSuppressed(false);
      expect(service.isBulkFeedbackSuppressed()).toBeFalse();
    });

    it('stays suppressed until the last of two overlapping bulk actions ends', () => {
      service.setBulkFeedbackSuppressed(true);
      service.setBulkFeedbackSuppressed(true);
      service.setBulkFeedbackSuppressed(false);
      // The second action is still dispatching; its per-task snacks must not escape.
      expect(service.isBulkFeedbackSuppressed()).toBeTrue();
      service.setBulkFeedbackSuppressed(false);
      expect(service.isBulkFeedbackSuppressed()).toBeFalse();
    });

    it('an unbalanced release cannot drive the depth negative', () => {
      service.setBulkFeedbackSuppressed(false);
      service.setBulkFeedbackSuppressed(true);
      expect(service.isBulkFeedbackSuppressed()).toBeTrue();
    });

    it('prune keeps only existing ids', () => {
      service.toggle('a');
      service.toggle('b');
      service.toggle('c');
      service.prune(new Set(['b', 'x']));
      expect(selected()).toEqual(['b']);
      expect(service.anchorId()).toBeNull();
    });

    it('clear empties everything including a pending menu request', () => {
      service.toggle('a');
      service.requestMenuOpen({ x: 1, y: 2 });
      service.clear();
      expect(service.count()).toBe(0);
      expect(service.menuOpenRequest()).toBeNull();
    });
  });
});
