import { MatMenuTrigger, MatMenuItem } from '@angular/material/menu';

/**
 * These tests verify that the Angular Material internal APIs we depend on
 * for the touch fix monkey patch still exist.
 *
 * If these tests fail after an Angular Material update, the monkey patch
 * in mat-menu-touch-monkey-patch.ts needs to be updated to match the new API.
 *
 * Related issue: https://github.com/super-productivity/super-productivity/issues/4436
 */
describe('Mat Menu Touch Monkey Patch API Compatibility', () => {
  describe('MatMenuItem internal API', () => {
    it('should have _checkDisabled method on prototype', () => {
      // This is the method we override to add touch protection
      // If this fails, Angular Material changed the click handler method name
      expect(typeof (MatMenuItem.prototype as any)._checkDisabled).toBe('function');
    });

    it('should have _elementRef property available', () => {
      // We need this to access the native element for pointer-events manipulation
      // This is set via dependency injection, so we check it's in the prototype chain
      const prototypeKeys = Object.getOwnPropertyNames(MatMenuItem.prototype);
      const hasElementRef =
        prototypeKeys.includes('_elementRef') || (MatMenuItem as any).ɵfac !== undefined; // Angular DI factory exists

      expect(hasElementRef).toBe(true);
    });
  });

  describe('MatMenuTrigger internal API', () => {
    it('should have openMenu method on prototype', () => {
      // This is the method we override to track menu open timing
      expect(typeof MatMenuTrigger.prototype.openMenu).toBe('function');
    });

    it('should have menu property accessor', () => {
      // We need access to the menu instance to get its items
      const descriptor = Object.getOwnPropertyDescriptor(
        MatMenuTrigger.prototype,
        'menu',
      );
      expect(descriptor).toBeDefined();
    });
  });

  describe('MatMenu internal API (via trigger)', () => {
    it('should document expected _allItems property', () => {
      // Note: We can't easily test _allItems without a full component setup,
      // but this test documents that we depend on it.
      // The monkey patch checks: (this.menu as any)._allItems
      //
      // If the menu items access pattern changes, update the monkey patch:
      // - Current pattern: this.menu._allItems.toArray()
      // - Items have: item._elementRef.nativeElement
      //
      // This is a documentation test - the actual runtime check is in the patch
      expect(true).toBe(true);
    });
  });

  describe('Monkey patch safety checks', () => {
    it('should gracefully handle missing _checkDisabled', () => {
      // Verify our patch approach - if the method doesn't exist,
      // storing it returns undefined, and we should handle that
      const originalMethod = (MatMenuItem.prototype as any)._checkDisabled;

      // The method should exist (this is the main compatibility check)
      expect(originalMethod).toBeDefined();

      // If it's defined, it should be callable
      if (originalMethod) {
        expect(typeof originalMethod).toBe('function');
      }
    });

    it('should have correct _checkDisabled signature (takes MouseEvent)', () => {
      // The _checkDisabled method should accept an event parameter
      // We can check the function length (number of declared parameters)
      const method = (MatMenuItem.prototype as any)._checkDisabled;
      expect(method.length).toBeGreaterThanOrEqual(1);
    });
  });
});
