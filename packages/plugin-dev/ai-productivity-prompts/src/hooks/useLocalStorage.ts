import { createSignal } from 'solid-js';

export const useLocalStorage = <T>(key: string, defaultValue: T) => {
  const [storedValue, setStoredValue] = createSignal<T>(getStoredValue());

  function getStoredValue(): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  }

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue()) : value;
      setStoredValue(() => valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue] as const;
};
