import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MentionDirective } from './mention.directive';
import { MentionConfig } from './mention-config';
import { Log } from '../../core/log';
import { MentionEvent } from './mention-types';

@Component({
  template: `<input [mentionConfig]="mentionConfig" />`,
  standalone: true,
  imports: [MentionDirective],
})
class TestComponent {
  mentionConfig: MentionConfig = {
    items: [],
  };
}

describe('MentionDirective', () => {
  let fixture: ComponentFixture<TestComponent>;
  let directive: MentionDirective;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestComponent, MentionDirective],
    }).compileComponents();

    fixture = TestBed.createComponent(TestComponent);

    const debugElement: DebugElement = fixture.debugElement.query(
      By.directive(MentionDirective),
    );
    directive = debugElement.injector.get(MentionDirective);

    fixture.detectChanges();
  });

  describe('DEFAULT_CONFIG mentionSelect', () => {
    let mentionSelect: (item: any, triggerChar?: string) => string;
    let logWarnSpy: jasmine.Spy;

    beforeEach(() => {
      // Access private DEFAULT_CONFIG for testing
      const defaultConfig = (directive as any).DEFAULT_CONFIG;
      mentionSelect = defaultConfig.mentionSelect.bind(directive);
      logWarnSpy = spyOn(Log, 'warn');
    });

    it('should handle undefined item gracefully', () => {
      const result = mentionSelect(undefined);

      expect(result).toBe('');
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionDirective: mentionSelect called with undefined/null item',
      );
    });

    it('should handle null item gracefully', () => {
      const result = mentionSelect(null);

      expect(result).toBe('');
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionDirective: mentionSelect called with undefined/null item',
      );
    });

    it('should handle item missing labelKey property', () => {
      const itemWithoutLabel = { id: '1', name: 'test' };
      const result = mentionSelect(itemWithoutLabel);

      expect(result).toBe('');
      expect(logWarnSpy).toHaveBeenCalledWith(
        "MentionDirective: item missing required property 'label'",
        itemWithoutLabel,
      );
    });

    it('should handle item with null labelKey property', () => {
      const itemWithNullLabel = { label: null, id: '1' };
      const result = mentionSelect(itemWithNullLabel);

      expect(result).toBe('');
      expect(logWarnSpy).toHaveBeenCalledWith(
        "MentionDirective: item missing required property 'label'",
        itemWithNullLabel,
      );
    });

    it('should return correct value for valid item', () => {
      // Set activeConfig to match DEFAULT_CONFIG
      (directive as any).activeConfig = {
        triggerChar: '@',
        labelKey: 'label',
      };

      const validItem = { label: 'test-tag', id: '1' };
      const result = mentionSelect(validItem);

      expect(result).toBe('@test-tag');
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should use custom labelKey when configured', () => {
      // Set custom activeConfig
      (directive as any).activeConfig = {
        labelKey: 'title',
        triggerChar: '#',
      };

      const validItem = { title: 'custom-tag', id: '1' };
      const result = mentionSelect(validItem);

      expect(result).toBe('#custom-tag');
      expect(logWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle item with missing custom labelKey', () => {
      (directive as any).activeConfig = {
        labelKey: 'title',
        triggerChar: '#',
      };

      const itemWithoutTitle = { label: 'test', id: '1' };
      const result = mentionSelect(itemWithoutTitle);

      expect(result).toBe('#');
      expect(logWarnSpy).toHaveBeenCalledWith(
        "MentionDirective: item missing required property 'title'",
        itemWithoutTitle,
      );
    });
  });

  describe('DEFAULT_CONFIG mentionFilter', () => {
    let mentionFilter: (searchString: string, items: any[]) => any[];
    let logWarnSpy: jasmine.Spy;

    beforeEach(() => {
      const defaultConfig = (directive as any).DEFAULT_CONFIG;
      mentionFilter = defaultConfig.mentionFilter.bind(directive);
      logWarnSpy = spyOn(Log, 'warn');
    });

    it('should handle undefined items array', () => {
      const result = mentionFilter('test', undefined as any);

      expect(result).toEqual([]);
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionDirective: mentionFilter called with invalid items array',
      );
    });

    it('should handle null items array', () => {
      const result = mentionFilter('test', null as any);

      expect(result).toEqual([]);
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionDirective: mentionFilter called with invalid items array',
      );
    });

    it('should handle non-array items parameter', () => {
      const result = mentionFilter('test', 'not-an-array' as any);

      expect(result).toEqual([]);
      expect(logWarnSpy).toHaveBeenCalledWith(
        'MentionDirective: mentionFilter called with invalid items array',
      );
    });

    it('should filter out undefined items', () => {
      const items = [{ label: 'test1' }, undefined, { label: 'test2' }, null];

      const result = mentionFilter('test', items);

      expect(result).toEqual([{ label: 'test1' }, { label: 'test2' }]);
    });

    it('should filter out items with invalid label property', () => {
      const items = [
        { label: 'test1' },
        { label: null },
        { label: undefined },
        { label: 123 }, // not a string
        { id: '1' }, // missing label
        { label: 'test2' },
      ];

      const result = mentionFilter('test', items);

      expect(result).toEqual([{ label: 'test1' }, { label: 'test2' }]);
    });

    it('should filter items by search string', () => {
      const items = [
        { label: 'apple' },
        { label: 'application' },
        { label: 'banana' },
        { label: 'app' },
      ];

      const result = mentionFilter('app', items);

      expect(result).toEqual([
        { label: 'apple' },
        { label: 'application' },
        { label: 'app' },
      ]);
    });

    it('should be case insensitive', () => {
      const items = [{ label: 'Apple' }, { label: 'APPLICATION' }, { label: 'banana' }];

      const result = mentionFilter('app', items);

      expect(result).toEqual([{ label: 'Apple' }, { label: 'APPLICATION' }]);
    });

    it('should use custom labelKey when configured', () => {
      (directive as any).activeConfig = {
        labelKey: 'title',
      };

      const items = [
        { title: 'test-tag', label: 'wrong' },
        { title: 'other-tag', label: 'test' },
      ];

      const result = mentionFilter('test', items);

      expect(result).toEqual([{ title: 'test-tag', label: 'wrong' }]);
    });

    it('should handle empty search string', () => {
      const items = [{ label: 'test1' }, { label: 'test2' }];

      const result = mentionFilter('', items);

      expect(result).toEqual(items);
    });
  });

  describe('stopEvent', () => {
    it('should handle standard event with all methods', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
        stopImmediatePropagation: jasmine.createSpy('stopImmediatePropagation'),
      };

      directive.stopEvent(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
    });

    it('should handle event with missing preventDefault method', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
        stopPropagation: jasmine.createSpy('stopPropagation'),
        stopImmediatePropagation: jasmine.createSpy('stopImmediatePropagation'),
      };

      // Should not throw error
      expect(() => directive.stopEvent(mockEvent)).not.toThrow();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
    });

    it('should handle event with missing stopPropagation method', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopImmediatePropagation: jasmine.createSpy('stopImmediatePropagation'),
      };

      expect(() => directive.stopEvent(mockEvent)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
    });

    it('should handle event with missing stopImmediatePropagation method', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
      };

      expect(() => directive.stopEvent(mockEvent)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should handle event with all methods missing', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
      };

      // Should not throw error
      expect(() => directive.stopEvent(mockEvent)).not.toThrow();
    });

    it('should handle event with non-function preventDefault property', () => {
      const mockEvent: MentionEvent = {
        wasClick: false,
        preventDefault: 'not-a-function' as any, // intentionally invalid for test
        stopPropagation: jasmine.createSpy('stopPropagation'),
        stopImmediatePropagation: jasmine.createSpy('stopImmediatePropagation'),
      };

      expect(() => directive.stopEvent(mockEvent)).not.toThrow();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
    });

    it('should not stop event when wasClick is true', () => {
      const mockEvent: MentionEvent = {
        wasClick: true,
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
        stopImmediatePropagation: jasmine.createSpy('stopImmediatePropagation'),
      };

      directive.stopEvent(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockEvent.stopPropagation).not.toHaveBeenCalled();
      expect(mockEvent.stopImmediatePropagation).not.toHaveBeenCalled();
    });

    it('should handle null event gracefully', () => {
      expect(() => directive.stopEvent(null)).not.toThrow();
    });

    it('should handle undefined event gracefully', () => {
      expect(() => directive.stopEvent(undefined as any)).not.toThrow();
    });
  });
});
