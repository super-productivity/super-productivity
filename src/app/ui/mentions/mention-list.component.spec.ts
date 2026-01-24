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
});
