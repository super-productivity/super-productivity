/**
 * TypeScript decorators for throttle and debounce
 * Simple implementation to eliminate lodash dependencies
 */

interface ThrottleState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastCallTime: number;
  lastArgs: unknown[] | null;
  lastThis: object | null;
  isLeadingInvoked: boolean;
}

interface DebounceState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastCallTime: number;
  isFirstCall: boolean;
}

// WeakMap to store per-instance throttle state
const throttleStateMap = new WeakMap<object, Map<string | symbol, ThrottleState>>();

// WeakMap to store per-instance debounce state
const debounceStateMap = new WeakMap<object, Map<string | symbol, DebounceState>>();

/**
 * Throttle decorator - limits function calls to once per specified time period
 * @param wait - Time in milliseconds to wait between calls
 * @param options - Optional configuration for leading/trailing execution
 */
export const throttle = (
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {},
): MethodDecorator => {
  // Validate wait parameter
  if (wait < 0 || !Number.isFinite(wait)) {
    throw new Error('Wait must be a positive finite number');
  }

  const leading = options.leading !== false;
  const trailing = options.trailing !== false;

  return (
    _target: unknown,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value as (...args: unknown[]) => void;

    descriptor.value = function (this: object, ...args: unknown[]): void {
      // Get or create state map for this instance
      let stateMap = throttleStateMap.get(this);
      if (!stateMap) {
        stateMap = new Map();
        throttleStateMap.set(this, stateMap);
      }

      // Get or create state for this method
      let state = stateMap.get(propertyKey);
      if (!state) {
        state = {
          timeoutId: null,
          lastCallTime: 0,
          lastArgs: null,
          lastThis: null,
          isLeadingInvoked: false,
        };
        stateMap.set(propertyKey, state);
      }

      const now = new Date().getTime();
      const remaining = wait - (now - state.lastCallTime);

      // Clear timeout if we're outside the throttle window
      if (remaining <= 0 || remaining > wait) {
        if (state.timeoutId) {
          clearTimeout(state.timeoutId);
          state.timeoutId = null;
        }
        // args stored for a late trailing call are superseded by this one
        state.lastArgs = null;
        state.lastThis = null;

        // Reset leading invoked flag since we're in a new throttle window
        state.isLeadingInvoked = false;
      }

      // Determine if we should invoke now
      const shouldInvokeNow =
        leading && !state.isLeadingInvoked && (remaining <= 0 || remaining > wait);

      if (shouldInvokeNow) {
        state.lastCallTime = now;
        state.isLeadingInvoked = true;
        try {
          originalMethod.apply(this, args);
        } catch (error) {
          // Re-throw but ensure state is consistent
          throw error;
        }
        // Don't store args for trailing if we just executed on leading edge
        // and there's no active timer (meaning this is the first call)
        if (state.timeoutId) {
          state.lastArgs = args;
          state.lastThis = this;
        }
      } else {
        // Store args for trailing execution
        state.lastArgs = args;
        state.lastThis = this;
      }

      // Set up trailing call if needed
      if (trailing && !state.timeoutId) {
        const delay = shouldInvokeNow
          ? wait
          : remaining > 0 && remaining < wait
            ? remaining
            : wait;
        state.timeoutId = setTimeout(() => {
          const hasArgs = state.lastArgs !== null;
          const shouldInvokeTrailing = hasArgs && trailing;

          // Reset state
          state.timeoutId = null;
          state.lastCallTime = hasArgs ? new Date().getTime() : 0;
          state.isLeadingInvoked = false;

          if (shouldInvokeTrailing && state.lastArgs && state.lastThis) {
            try {
              originalMethod.apply(state.lastThis, state.lastArgs);
            } catch (error) {
              // Still clean up state even if method throws
              state.lastArgs = null;
              state.lastThis = null;
              throw error;
            }
          }

          state.lastArgs = null;
          state.lastThis = null;
        }, delay);
      }
    };

    return descriptor;
  };
};

/**
 * Debounce decorator - delays function execution until after wait milliseconds
 * have elapsed since the last time it was invoked
 * @param wait - Time in milliseconds to delay execution
 * @param options - Optional configuration for leading execution
 */
export const debounce = (
  wait: number,
  options: { leading?: boolean } = {},
): MethodDecorator => {
  // Validate wait parameter
  if (wait < 0 || !Number.isFinite(wait)) {
    throw new Error('Wait must be a positive finite number');
  }

  const leading = !!options.leading;

  return (
    _target: unknown,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value as (...args: unknown[]) => void;

    descriptor.value = function (this: object, ...args: unknown[]): void {
      // Get or create state map for this instance
      let stateMap = debounceStateMap.get(this);
      if (!stateMap) {
        stateMap = new Map();
        debounceStateMap.set(this, stateMap);
      }

      // Get or create state for this method
      let state = stateMap.get(propertyKey);
      if (!state) {
        state = {
          timeoutId: null,
          lastCallTime: 0,
          isFirstCall: true,
        };
        stateMap.set(propertyKey, state);
      }

      // Determine if we should call immediately (leading edge)
      const callNow = leading && state.isFirstCall;

      // Clear existing timeout
      if (state.timeoutId) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }

      if (callNow) {
        // Execute immediately on leading edge
        state.isFirstCall = false;
        state.lastCallTime = new Date().getTime();
        try {
          originalMethod.apply(this, args);
        } catch (error) {
          // Re-throw but ensure state is consistent
          throw error;
        }
      }

      // Set up the debounced call
      state.timeoutId = setTimeout(() => {
        state.timeoutId = null;
        state.lastCallTime = new Date().getTime();
        state.isFirstCall = true; // Reset for next sequence

        if (!leading) {
          // Only execute on trailing edge if leading is false
          try {
            originalMethod.apply(this, args);
          } catch (error) {
            // Still clean up state even if method throws
            throw error;
          }
        }
      }, wait);
    };

    return descriptor;
  };
};
