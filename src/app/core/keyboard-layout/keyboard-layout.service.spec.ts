import { TestBed } from '@angular/core/testing';
import {
  KeyboardLayoutService,
  KeyboardLayout,
  NavigatorWithKeyboard,
} from './keyboard-layout.service';

describe('KeyboardLayoutService', () => {
  let service: KeyboardLayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [KeyboardLayoutService],
    });
    service = TestBed.inject(KeyboardLayoutService);
  });

  afterEach(() => {
    service.clear();
  });

  describe('layout getter', () => {
    it('should return empty map initially', () => {
      expect(service.layout).toBeInstanceOf(Map);
      expect(service.layout.size).toBe(0);
    });

    it('should return the current layout after setLayout', () => {
      const testLayout: KeyboardLayout = new Map([
        ['KeyA', 'a'],
        ['KeyB', 'b'],
      ]);
      service.setLayout(testLayout);

      expect(service.layout.size).toBe(2);
      expect(service.layout.get('KeyA')).toBe('a');
      expect(service.layout.get('KeyB')).toBe('b');
    });
  });

  describe('setLayout', () => {
    it('should set the layout from provided map', () => {
      const testLayout: KeyboardLayout = new Map([
        ['KeyQ', 'q'],
        ['KeyW', 'w'],
        ['KeyE', 'e'],
      ]);

      service.setLayout(testLayout);

      expect(service.layout.size).toBe(3);
      expect(service.layout.get('KeyQ')).toBe('q');
      expect(service.layout.get('KeyW')).toBe('w');
      expect(service.layout.get('KeyE')).toBe('e');
    });

    it('should replace existing layout', () => {
      const firstLayout: KeyboardLayout = new Map([
        ['KeyA', 'a'],
        ['KeyB', 'b'],
      ]);
      const secondLayout: KeyboardLayout = new Map([['KeyZ', 'z']]);

      service.setLayout(firstLayout);
      expect(service.layout.size).toBe(2);

      service.setLayout(secondLayout);
      expect(service.layout.size).toBe(1);
      expect(service.layout.get('KeyZ')).toBe('z');
      expect(service.layout.has('KeyA')).toBe(false);
    });

    it('should handle empty map', () => {
      service.setLayout(
        new Map([
          ['KeyA', 'a'],
          ['KeyB', 'b'],
        ]),
      );
      expect(service.layout.size).toBe(2);

      service.setLayout(new Map());
      expect(service.layout.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear the layout', () => {
      service.setLayout(
        new Map([
          ['KeyA', 'a'],
          ['KeyB', 'b'],
        ]),
      );
      expect(service.layout.size).toBe(2);

      service.clear();

      expect(service.layout.size).toBe(0);
    });

    it('should handle clearing already empty layout', () => {
      service.clear();
      expect(service.layout.size).toBe(0);
    });
  });

  describe('saveUserLayout', () => {
    const originalNavigator = globalThis.navigator;

    afterEach(() => {
      // Restore original navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('should do nothing if keyboard API is not available', async () => {
      // Mock navigator without keyboard
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      await service.saveUserLayout();

      expect(service.layout.size).toBe(0);
    });

    it('should do nothing if keyboard is undefined', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { keyboard: undefined } as NavigatorWithKeyboard,
        writable: true,
        configurable: true,
      });

      await service.saveUserLayout();

      expect(service.layout.size).toBe(0);
    });

    it('should save layout from keyboard API', async () => {
      const mockLayoutMap = new Map([
        ['KeyA', 'a'],
        ['KeyS', 's'],
        ['KeyD', 'd'],
      ]);

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          keyboard: {
            getLayoutMap: () => Promise.resolve(mockLayoutMap),
          },
        } as NavigatorWithKeyboard,
        writable: true,
        configurable: true,
      });

      await service.saveUserLayout();

      expect(service.layout.size).toBe(3);
      expect(service.layout.get('KeyA')).toBe('a');
      expect(service.layout.get('KeyS')).toBe('s');
      expect(service.layout.get('KeyD')).toBe('d');
    });

    it('should replace existing layout when called again', async () => {
      service.setLayout(
        new Map([
          ['KeyX', 'x'],
          ['KeyY', 'y'],
        ]),
      );

      const mockLayoutMap = new Map([['KeyZ', 'z']]);

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          keyboard: {
            getLayoutMap: () => Promise.resolve(mockLayoutMap),
          },
        } as NavigatorWithKeyboard,
        writable: true,
        configurable: true,
      });

      await service.saveUserLayout();

      expect(service.layout.size).toBe(1);
      expect(service.layout.get('KeyZ')).toBe('z');
      expect(service.layout.has('KeyX')).toBe(false);
    });
  });
});
