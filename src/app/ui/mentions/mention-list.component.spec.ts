import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MentionListComponent } from './mention-list.component';
import { CommonModule } from '@angular/common';
import { Log } from '../../core/log';

describe('MentionListComponent', () => {
  let component: MentionListComponent;
  let fixture: ComponentFixture<MentionListComponent>;
  let logWarnSpy: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MentionListComponent, CommonModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MentionListComponent);
    component = fixture.componentInstance;
    logWarnSpy = spyOn(Log, 'warn');
    fixture.detectChanges();
  });

  describe('activeItem getter', () => {
    beforeEach(() => {
      logWarnSpy.calls.reset();
    });

    it('should return null for empty items array', () => {
      component.items = [];
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return null for undefined items array', () => {
      component.items = undefined as any;
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return null for null items array', () => {
      component.items = null as any;
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return null for non-array items', () => {
      component.items = 'not-an-array' as any;
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return null and warn for negative activeIndex', () => {
      component.items = [{ label: 'test1' }, { label: 'test2' }] as any;
      component.activeIndex = -1;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionListComponent: activeIndex -1 is out of bounds for items array of length 2',
      );
    });

    it('should return null and warn for activeIndex beyond array length', () => {
      component.items = [{ label: 'test1' }, { label: 'test2' }] as any;
      component.activeIndex = 2;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionListComponent: activeIndex 2 is out of bounds for items array of length 2',
      );
    });

    it('should return null and warn for activeIndex far beyond array length', () => {
      component.items = [{ label: 'test1' }] as any;
      component.activeIndex = 10;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionListComponent: activeIndex 10 is out of bounds for items array of length 1',
      );
    });

    it('should return correct item for valid activeIndex', () => {
      const testItems = [{ label: 'test1' }, { label: 'test2' }, { label: 'test3' }];
      component.items = testItems as any;
      component.activeIndex = 1;

      const result = component.activeItem;

      expect(result).toBe(testItems[1]);
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return first item when activeIndex is 0', () => {
      const testItems = [{ label: 'first' }, { label: 'second' }];
      component.items = testItems as any;
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBe(testItems[0]);
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return last item when activeIndex is at last position', () => {
      const testItems = [{ label: 'first' }, { label: 'second' }, { label: 'last' }];
      component.items = testItems as any;
      component.activeIndex = 2;

      const result = component.activeItem;

      expect(result).toBe(testItems[2]);
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle single item array correctly', () => {
      const testItems = [{ label: 'only-item' }];
      component.items = testItems as any;
      component.activeIndex = 0;

      const result = component.activeItem;

      expect(result).toBe(testItems[0]);
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle items with null/undefined elements', () => {
      const testItems = [{ label: 'test1' }, null, undefined, { label: 'test2' }];
      component.items = testItems as any;
      component.activeIndex = 1;

      const result = component.activeItem;

      expect(result).toBeNull();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should return undefined item at valid index', () => {
      const testItems = [{ label: 'test1' }, undefined, { label: 'test2' }];
      component.items = testItems as any;
      component.activeIndex = 1;

      const result = component.activeItem;

      expect(result).toBeUndefined();
      expect(logWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('activateNextItem', () => {
    it('should handle empty items array gracefully', () => {
      component.items = [] as any;
      component.activeIndex = 0;

      expect(() => component.activateNextItem()).not.toThrow();
      expect(component.activeIndex).toBe(0);
    });

    it('should increment activeIndex within bounds', () => {
      component.items = [
        { label: 'test1' },
        { label: 'test2' },
        { label: 'test3' },
      ] as any;
      component.activeIndex = 0;

      component.activateNextItem();

      expect(component.activeIndex).toBe(1);
    });

    it('should not exceed array bounds', () => {
      component.items = [{ label: 'test1' }, { label: 'test2' }] as any;
      component.activeIndex = 1; // last item

      component.activateNextItem();

      expect(component.activeIndex).toBe(1); // should stay at last item
    });
  });

  describe('activatePreviousItem', () => {
    it('should handle empty items array gracefully', () => {
      component.items = [] as any;
      component.activeIndex = 0;

      expect(() => component.activatePreviousItem()).not.toThrow();
      expect(component.activeIndex).toBe(0);
    });

    it('should decrement activeIndex within bounds', () => {
      component.items = [
        { label: 'test1' },
        { label: 'test2' },
        { label: 'test3' },
      ] as any;
      component.activeIndex = 2;

      component.activatePreviousItem();

      expect(component.activeIndex).toBe(1);
    });

    it('should not go below zero', () => {
      component.items = [{ label: 'test1' }, { label: 'test2' }] as any;
      component.activeIndex = 0; // first item

      component.activatePreviousItem();

      expect(component.activeIndex).toBe(0); // should stay at first item
    });
  });

  /**
   * Issue #5146: on touch devices the global add-task bar is pinned to the
   * bottom of the screen (`:host-context(.isTouchPrimary).global`), yet the
   * mention list always opened downwards from the caret — so the whole
   * `#tag` / `@due` / `+project` list rendered past the bottom edge and the
   * user saw a blank strip over the action-chip row with no entries in it.
   */
  describe('drop direction', () => {
    const stubList = (opts: {
      top: number;
      height: number;
      viewportHeight: number;
      /** Defaults to `viewportHeight` — the two only differ once an IME is up. */
      visualViewportHeight?: number;
    }): void => {
      spyOnProperty(window, 'innerHeight', 'get').and.returnValue(opts.viewportHeight);
      spyOnProperty(window, 'visualViewport', 'get').and.returnValue({
        height: opts.visualViewportHeight ?? opts.viewportHeight,
      } as VisualViewport);
      spyOn(component.list.nativeElement, 'getBoundingClientRect').and.returnValue({
        top: opts.top,
        bottom: opts.top + opts.height,
        left: 48,
        right: 202,
        width: 154,
        height: opts.height,
        x: 48,
        y: opts.top,
        toJSON: () => ({}),
      } as DOMRect);
    };

    const hasDropUpClass = (): boolean =>
      (component.list.nativeElement as HTMLElement).classList.contains(
        'mention-dropdown',
      );

    beforeEach(() => {
      component.items = Array.from({ length: 8 }, (_, i) => ({
        label: `item${i}`,
      })) as any;
      // `checkNoChanges` trips on the `@for` views created by this first pass
      fixture.detectChanges(false);
    });

    it('should flip above the caret when the list would run past the bottom edge', () => {
      // bar pinned to the bottom: a 292px list starting at y=579 ends at 871
      stubList({ top: 579, height: 292, viewportHeight: 640 });

      component.reset();
      fixture.detectChanges(false);

      expect(component.dropUp).toBe(true);
      expect(hasDropUpClass()).toBe(true);
    });

    it('should keep dropping down when the list fits below the caret', () => {
      stubList({ top: 80, height: 292, viewportHeight: 640 });

      component.reset();
      fixture.detectChanges(false);

      expect(component.dropUp).toBe(false);
      expect(hasDropUpClass()).toBe(false);
    });

    it('should keep dropping down when it overflows but there is more room below', () => {
      // bar near the top: a 560px list from y=120 overflows the bottom, but
      // flipping it would leave only 120px above vs 520px below
      stubList({ top: 120, height: 560, viewportHeight: 640 });

      component.reset();
      fixture.detectChanges(false);

      expect(component.dropUp).toBe(false);
    });

    it('should measure against the visual viewport when the layout one does not shrink', () => {
      // Android's WebView does not always apply adjustResize, so `innerHeight`
      // stays at the full screen while the IME covers the bottom — only
      // `visualViewport` sees the area that is actually visible. The bar has
      // already moved up via `--keyboard-height`, so a list that looks like it
      // fits below is really rendering into the keyboard.
      stubList({
        top: 460,
        height: 292,
        viewportHeight: 800,
        visualViewportHeight: 500,
      });

      component.reset();
      fixture.detectChanges(false);

      expect(component.dropUp).toBe(true);
      expect(hasDropUpClass()).toBe(true);
    });

    it('should measure a reused list at its natural height, not the previous cap', () => {
      // a first `#` search capped the list; the following `+` search must not be
      // measured against that leftover cap
      const listEl = component.list.nativeElement as HTMLElement;
      listEl.style.maxHeight = '120px';
      stubList({ top: 579, height: 292, viewportHeight: 640 });
      let capAtMeasureTime = 'not-measured';
      (listEl.getBoundingClientRect as jasmine.Spy).and.callFake(() => {
        capAtMeasureTime = listEl.style.maxHeight;
        return { top: 579, bottom: 871, height: 292, left: 48, width: 154 } as DOMRect;
      });

      component.reset();

      expect(capAtMeasureTime).toBe('');
    });

    it('should cap the height when the flipped list does not fit above either', () => {
      // on-screen keyboard open: 330px of viewport, bar at the bottom
      stubList({ top: 269, height: 292, viewportHeight: 330 });

      component.reset();

      expect(component.dropUp).toBe(true);
      const maxHeight = parseFloat(
        (component.list.nativeElement as HTMLElement).style.maxHeight,
      );
      expect(maxHeight).toBeGreaterThan(0);
      expect(maxHeight).toBeLessThanOrEqual(269);
    });
  });
});
