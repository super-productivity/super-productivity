import { signal, ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createDropdownNavigation } from './create-dropdown-navigation';

interface MockItem {
  id: string;
  title: string;
}

describe('createDropdownNavigation', () => {
  let mockItems: MockItem[];
  let filteredItemsSignal: ReturnType<typeof signal<MockItem[]>>;
  let selectionSpy: jasmine.Spy;
  let menuTriggerSpy: jasmine.SpyObj<{ closeMenu: () => void }>;
  let menuItemsSpy: jasmine.Spy;

  beforeEach(() => {
    mockItems = [
      { id: '1', title: 'Project A' },
      { id: '2', title: 'Project B' },
      { id: '3', title: 'Project C' },
    ];
    filteredItemsSignal = signal(mockItems);
    selectionSpy = jasmine.createSpy('onSelect');
    menuTriggerSpy = jasmine.createSpyObj('MenuTrigger', ['closeMenu']);
    menuItemsSpy = jasmine
      .createSpy('getMenuItems')
      .and.returnValue([
        { nativeElement: jasmine.createSpyObj('Element', ['scrollIntoView']) },
        { nativeElement: jasmine.createSpyObj('Element', ['scrollIntoView']) },
        { nativeElement: jasmine.createSpyObj('Element', ['scrollIntoView']) },
      ] as unknown as ElementRef[]);
  });

  it('should initialize active index to 0', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );
      expect(helper.activeIndex()).toBe(0);
    });
  });

  it('should adjust active index down and wrap around', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );

      helper.adjustActiveIndex('down');
      expect(helper.activeIndex()).toBe(1);

      helper.adjustActiveIndex('down');
      expect(helper.activeIndex()).toBe(2);

      helper.adjustActiveIndex('down');
      expect(helper.activeIndex()).toBe(0); // circular wrap
    });
  });

  it('should adjust active index up and wrap around', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );

      helper.adjustActiveIndex('up');
      expect(helper.activeIndex()).toBe(2); // wraps to last

      helper.adjustActiveIndex('up');
      expect(helper.activeIndex()).toBe(1);
    });
  });

  it('should select active item and close menu', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );

      helper.setActiveIndex(1);
      const mockEvent = jasmine.createSpyObj('Event', [
        'preventDefault',
        'stopPropagation',
      ]);
      helper.selectActive(mockEvent);

      expect(selectionSpy).toHaveBeenCalledWith(mockItems[1]);
      expect(menuTriggerSpy.closeMenu).toHaveBeenCalled();
    });
  });

  it('should reset active index', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );

      helper.setActiveIndex(2);
      expect(helper.activeIndex()).toBe(2);

      helper.resetActive(mockItems, 1);
      expect(helper.activeIndex()).toBe(1);
    });
  });

  it('should sync/clamp index when filtered items change', () => {
    TestBed.runInInjectionContext(() => {
      const helper = createDropdownNavigation(
        filteredItemsSignal,
        selectionSpy,
        () => menuTriggerSpy,
        menuItemsSpy,
      );

      // Start on index 2 (Project C)
      helper.setActiveIndex(2);
      expect(helper.activeIndex()).toBe(2);

      // Filter to only Project A and Project C
      const newItems = [mockItems[0], mockItems[2]];
      filteredItemsSignal.set(newItems);

      // Effect is run asynchronously in signal graph, but we check if it updates to index 1 (Project C's new index)
      TestBed.flushEffects();
      expect(helper.activeIndex()).toBe(1); // Project C is now at index 1

      // Now filter to item that is not in the list (Project A only)
      filteredItemsSignal.set([mockItems[0]]);
      TestBed.flushEffects();
      expect(helper.activeIndex()).toBe(0); // clamps to 0 since Project C is gone
    });
  });
});
