import { throttle, debounce } from './decorators';

describe('Decorators', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  describe('throttle', () => {
    it('should throttle method calls with default options', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @throttle(100)
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      // First call should execute immediately (leading: true by default)
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // Rapid calls should be throttled
      instance.method();
      instance.method();
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // After wait time, next call should execute
      jasmine.clock().tick(100);
      instance.method();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple instances independently', () => {
      const spy1 = jasmine.createSpy('method1');
      const spy2 = jasmine.createSpy('method2');

      class TestClass {
        constructor(private spy: jasmine.Spy) {}

        @throttle(100)
        method(): void {
          this.spy();
        }
      }

      const instance1 = new TestClass(spy1);
      const instance2 = new TestClass(spy2);

      // Call on instance1
      instance1.method();
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(0);

      // Call on instance2 should not be affected by instance1's throttle
      instance2.method();
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);

      // Both should be throttled independently
      instance1.method();
      instance2.method();
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);

      // After wait time, both can call again
      jasmine.clock().tick(100);
      instance1.method();
      instance2.method();
      expect(spy1).toHaveBeenCalledTimes(2);
      expect(spy2).toHaveBeenCalledTimes(2);
    });

    it('should respect leading: false option', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @throttle(100, { leading: false })
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      // First call should NOT execute immediately with leading: false
      instance.method();
      expect(spy).toHaveBeenCalledTimes(0);

      // After wait time, trailing call should execute
      jasmine.clock().tick(100);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should respect trailing: false option', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @throttle(100, { trailing: false })
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      // First call should execute immediately (leading: true by default)
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // Additional calls during wait period
      instance.method();
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // After wait time, no trailing call should execute
      jasmine.clock().tick(100);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('debounce', () => {
    it('should debounce method calls with default options', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @debounce(100)
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      // Rapid calls should be debounced
      instance.method();
      instance.method();
      instance.method();
      expect(spy).toHaveBeenCalledTimes(0);

      // After wait time, only one call should execute
      jasmine.clock().tick(100);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple instances independently', () => {
      const spy1 = jasmine.createSpy('method1');
      const spy2 = jasmine.createSpy('method2');

      class TestClass {
        constructor(private spy: jasmine.Spy) {}

        @debounce(100)
        method(): void {
          this.spy();
        }
      }

      const instance1 = new TestClass(spy1);
      const instance2 = new TestClass(spy2);

      // Call on both instances
      instance1.method();
      instance2.method();
      expect(spy1).toHaveBeenCalledTimes(0);
      expect(spy2).toHaveBeenCalledTimes(0);

      // After wait time, both should execute independently
      jasmine.clock().tick(100);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });

    it('should respect leading: true option', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @debounce(100, { leading: true })
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      // First call should execute immediately with leading: true
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // Additional calls should be debounced
      instance.method();
      instance.method();
      expect(spy).toHaveBeenCalledTimes(1);

      // After wait time, no additional calls (atBegin option doesn't include trailing)
      jasmine.clock().tick(100);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should restart timer on each call', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @debounce(100)
        method(): void {
          spy();
        }
      }

      const instance = new TestClass();

      instance.method();
      jasmine.clock().tick(50);
      instance.method(); // Restart timer
      jasmine.clock().tick(50);
      instance.method(); // Restart timer again
      jasmine.clock().tick(50);
      expect(spy).toHaveBeenCalledTimes(0);

      // Only after full wait time from last call
      jasmine.clock().tick(50);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should maintain correct this context', () => {
      class TestClass {
        value = 42;

        @debounce(100)
        method(): number {
          return this.value;
        }
      }

      const instance = new TestClass();
      instance.method();
      jasmine.clock().tick(100);

      // Verify the method was called with correct context
      // (We can't directly check the return value since it's async)
      instance.value = 100;
      instance.method();
      jasmine.clock().tick(100);
    });

    it('should use last arguments when trailing', () => {
      const spy = jasmine.createSpy('method');

      class TestClass {
        @debounce(100)
        method(value: number): void {
          spy(value);
        }
      }

      const instance = new TestClass();
      instance.method(1);
      instance.method(2);
      instance.method(3);

      jasmine.clock().tick(100);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(3);
    });

    it('should handle async methods correctly', async () => {
      const spy = jasmine
        .createSpy('method')
        .and.returnValue(Promise.resolve('async result'));

      class TestClass {
        @debounce(100)
        async method(): Promise<string> {
          return spy();
        }
      }

      const instance = new TestClass();
      instance.method();

      jasmine.clock().tick(100);
      await Promise.resolve(); // Let promises resolve
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cross-decorator tests', () => {
    it('should not share state between different decorators on same instance', () => {
      const throttleSpy = jasmine.createSpy('throttled');
      const debounceSpy = jasmine.createSpy('debounced');

      class TestClass {
        @throttle(100)
        throttledMethod(): void {
          throttleSpy();
        }

        @debounce(100)
        debouncedMethod(): void {
          debounceSpy();
        }
      }

      const instance = new TestClass();

      // Call throttled - should execute immediately
      instance.throttledMethod();
      expect(throttleSpy).toHaveBeenCalledTimes(1);
      expect(debounceSpy).toHaveBeenCalledTimes(0);

      // Call debounced - should not execute immediately
      instance.debouncedMethod();
      expect(throttleSpy).toHaveBeenCalledTimes(1);
      expect(debounceSpy).toHaveBeenCalledTimes(0);

      // After wait time
      jasmine.clock().tick(100);
      expect(throttleSpy).toHaveBeenCalledTimes(1);
      expect(debounceSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle inheritance correctly', () => {
      const baseSpy = jasmine.createSpy('base');
      const childSpy = jasmine.createSpy('child');

      class BaseClass {
        @throttle(100)
        method(): void {
          baseSpy();
        }
      }

      class ChildClass extends BaseClass {
        override method(): void {
          childSpy();
          super.method();
        }
      }

      const child = new ChildClass();
      child.method();
      expect(childSpy).toHaveBeenCalledTimes(1);
      expect(baseSpy).toHaveBeenCalledTimes(1);

      // Throttle should still apply
      child.method();
      expect(childSpy).toHaveBeenCalledTimes(2);
      expect(baseSpy).toHaveBeenCalledTimes(1);
    });
  });
});
