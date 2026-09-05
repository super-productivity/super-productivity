import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { TaskMultiSelectService } from './task-multi-select.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';

describe('TaskMultiSelectService', () => {
  let service: TaskMultiSelectService;
  let routerEvents$: Subject<unknown>;
  let workContext$: Subject<{ activeId: string; activeType: WorkContextType }>;
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
    routerEvents$ = new Subject();
    workContext$ = new Subject();
    TestBed.configureTestingModule({
      providers: [
        TaskMultiSelectService,
        { provide: Router, useValue: { events: routerEvents$.asObservable() } },
        {
          provide: WorkContextService,
          useValue: { activeWorkContextTypeAndId$: workContext$.asObservable() },
        },
      ],
    });
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
      // anchor stays where it was when removing another row
      expect(service.anchorId()).toBe('c');

      service.toggle('a');
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

  describe('remove / prune / clear', () => {
    it('remove drops one id and resets a removed anchor', () => {
      service.toggle('a');
      service.toggle('b');
      service.remove('b');
      expect(selected()).toEqual(['a']);
      expect(service.anchorId()).toBeNull();
    });

    it('removeWhenUnrendered keeps an id whose row is still rendered', async () => {
      service.toggle('a');
      service.removeWhenUnrendered('a');
      await new Promise((resolve) => setTimeout(resolve));
      expect(selected()).toEqual(['a']);
    });

    it('removeWhenUnrendered drops an id whose row is gone', async () => {
      service.toggle('a');
      root.querySelector('task[data-task-id="a"]')?.remove();
      service.removeWhenUnrendered('a');
      await new Promise((resolve) => setTimeout(resolve));
      expect(selected()).toEqual([]);
    });

    it('bulk feedback suppression is off by default and settable', () => {
      expect(service.isBulkFeedbackSuppressed()).toBeFalse();
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

    it('clears on navigation', () => {
      service.toggle('a');
      routerEvents$.next(new NavigationEnd(1, '/x', '/x'));
      expect(service.count()).toBe(0);
    });

    it('clears on work context change', () => {
      service.toggle('a');
      workContext$.next({ activeId: 'p2', activeType: WorkContextType.PROJECT });
      expect(service.count()).toBe(0);
    });
  });
});
