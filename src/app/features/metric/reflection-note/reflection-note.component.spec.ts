import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { of, Subject, BehaviorSubject } from 'rxjs';
import { ReflectionNoteComponent } from './reflection-note.component';
import { MetricService } from '../metric.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { TranslateService, LangChangeEvent } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { DEFAULT_METRIC_FOR_DAY } from '../metric.const';
import { Metric } from '../metric.model';

describe('ReflectionNoteComponent', () => {
  let component: ReflectionNoteComponent;
  let mockMetricService: jasmine.SpyObj<MetricService>;
  let mockGlobalTrackingIntervalService: { todayDateStr: () => string };
  let mockTranslateService: {
    onLangChange: Subject<LangChangeEvent>;
    instant: jasmine.Spy;
  };
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let environmentInjector: EnvironmentInjector;
  let metricForDay$: BehaviorSubject<Metric>;

  const TODAY = '2025-01-15';

  beforeEach(() => {
    metricForDay$ = new BehaviorSubject<Metric>({
      id: TODAY,
      ...DEFAULT_METRIC_FOR_DAY,
      reflections: [],
    } as Metric);

    mockMetricService = jasmine.createSpyObj('MetricService', [
      'getMetricForDay$',
      'getAllMetrics$',
      'upsertMetric',
    ]);
    mockMetricService.getMetricForDay$.and.returnValue(metricForDay$.asObservable());
    mockMetricService.getAllMetrics$.and.returnValue(of([]));

    mockGlobalTrackingIntervalService = {
      todayDateStr: () => TODAY,
    };

    mockTranslateService = {
      onLangChange: new Subject<LangChangeEvent>(),
      instant: jasmine.createSpy('instant').and.returnValue('placeholder text'),
    };

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      providers: [
        { provide: MetricService, useValue: mockMetricService },
        {
          provide: GlobalTrackingIntervalService,
          useValue: mockGlobalTrackingIntervalService,
        },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);
  });

  const createComponent = (): void => {
    runInInjectionContext(environmentInjector, () => {
      component = new ReflectionNoteComponent();
    });
  };

  describe('trailing space bug fix', () => {
    it('should preserve trailing spaces in inputText while typing', fakeAsync(() => {
      createComponent();
      tick(); // Allow initial effect to run

      // User types "Hello "
      component.onReflectionChange('Hello ');
      tick();

      // inputText should preserve the trailing space
      expect(component.inputText()).toBe('Hello ');
    }));

    it('should NOT overwrite trailing spaces after debounce', fakeAsync(() => {
      createComponent();
      tick();

      // User types "Hello "
      component.onReflectionChange('Hello ');
      expect(component.inputText()).toBe('Hello ');

      // Wait for debounce (500ms)
      tick(500);

      // Simulate store update with trimmed value
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Hello', created: Date.now() }],
      } as Metric);
      tick();

      // inputText should still preserve the user's trailing space
      // because trimmed stored value matches trimmed user input
      expect(component.inputText()).toBe('Hello ');

      flush();
    }));

    it('should persist trimmed value to store', fakeAsync(() => {
      createComponent();
      tick();

      // User types "Hello "
      component.onReflectionChange('Hello ');

      // Wait for debounce
      tick(500);

      // Verify upsertMetric was called with trimmed text
      expect(mockMetricService.upsertMetric).toHaveBeenCalled();
      const calledWith = mockMetricService.upsertMetric.calls.mostRecent().args[0];
      expect(calledWith.reflections?.[0]?.text).toBe('Hello');

      flush();
    }));

    it('should update inputText when external change differs from user input', fakeAsync(() => {
      createComponent();
      tick();

      // User types "Hello"
      component.onReflectionChange('Hello');
      tick(500);

      // External sync updates with completely different text
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Different text from sync', created: Date.now() }],
      } as Metric);
      tick();

      // inputText should update because stored text differs from user input
      expect(component.inputText()).toBe('Different text from sync');

      flush();
    }));

    it('should update inputText when day changes', fakeAsync(() => {
      createComponent();
      tick();

      // User types something for today
      component.onReflectionChange('Today note');
      tick(500);

      // Simulate day change - getMetricForDay$ now returns different day's data
      metricForDay$.next({
        id: '2025-01-16',
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Different day note', created: Date.now() }],
      } as Metric);
      tick();

      // inputText should update to show the new day's note
      expect(component.inputText()).toBe('Different day note');

      flush();
    }));

    it('should handle empty input correctly', fakeAsync(() => {
      createComponent();
      tick();

      // Start with some text
      component.onReflectionChange('Hello');
      tick(500);

      // Clear the input
      component.onReflectionChange('');
      tick(500);

      // Should call upsertMetric with empty reflections array
      const calledWith = mockMetricService.upsertMetric.calls.mostRecent().args[0];
      expect(calledWith.reflections).toEqual([]);

      flush();
    }));

    it('should handle null/undefined input', fakeAsync(() => {
      createComponent();
      tick();

      // Pass null (via type casting for test purposes)
      component.onReflectionChange(null as unknown as string);
      expect(component.inputText()).toBe('');

      flush();
    }));

    it('should preserve multiple trailing spaces', fakeAsync(() => {
      createComponent();
      tick();

      // User types with multiple trailing spaces
      component.onReflectionChange('Hello   ');
      tick();

      expect(component.inputText()).toBe('Hello   ');

      tick(500);

      // Store gets trimmed value
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Hello', created: Date.now() }],
      } as Metric);
      tick();

      // User's multiple trailing spaces should be preserved
      expect(component.inputText()).toBe('Hello   ');

      flush();
    }));

    it('should preserve leading and trailing spaces while typing', fakeAsync(() => {
      createComponent();
      tick();

      // User types with leading and trailing spaces
      component.onReflectionChange('  Hello  ');
      tick();

      expect(component.inputText()).toBe('  Hello  ');

      flush();
    }));

    it('should handle rapid typing that resets debounce', fakeAsync(() => {
      createComponent();
      tick();

      // User types quickly, each keystroke resets debounce
      component.onReflectionChange('H');
      tick(100);
      component.onReflectionChange('He');
      tick(100);
      component.onReflectionChange('Hel');
      tick(100);
      component.onReflectionChange('Hell');
      tick(100);
      component.onReflectionChange('Hello');
      tick(100);
      component.onReflectionChange('Hello '); // trailing space

      // Not yet 500ms since last change
      expect(mockMetricService.upsertMetric).not.toHaveBeenCalled();
      expect(component.inputText()).toBe('Hello ');

      // Wait for debounce to complete
      tick(500);

      // Now it should persist
      expect(mockMetricService.upsertMetric).toHaveBeenCalledTimes(1);
      const calledWith = mockMetricService.upsertMetric.calls.mostRecent().args[0];
      expect(calledWith.reflections?.[0]?.text).toBe('Hello');

      flush();
    }));

    it('should allow continued typing after debounce + store update', fakeAsync(() => {
      createComponent();
      tick();

      // First typing session
      component.onReflectionChange('Hello ');
      tick(500);

      // Store updates with trimmed value
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Hello', created: Date.now() }],
      } as Metric);
      tick();

      // User continues typing (adding " world")
      component.onReflectionChange('Hello world ');
      tick();

      // Should preserve new input with trailing space
      expect(component.inputText()).toBe('Hello world ');

      // Wait for second debounce
      tick(500);

      // Store updates again
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Hello world', created: Date.now() }],
      } as Metric);
      tick();

      // Should still preserve trailing space
      expect(component.inputText()).toBe('Hello world ');

      flush();
    }));

    it('should handle whitespace-only input', fakeAsync(() => {
      createComponent();
      tick();

      // User types only spaces
      component.onReflectionChange('   ');
      tick();

      expect(component.inputText()).toBe('   ');

      // Wait for debounce
      tick(500);

      // Trimmed value is empty, so reflections should be empty array
      const calledWith = mockMetricService.upsertMetric.calls.mostRecent().args[0];
      expect(calledWith.reflections).toEqual([]);

      flush();
    }));

    it('should handle store update while user is actively typing', fakeAsync(() => {
      createComponent();
      tick();

      // User starts typing
      component.onReflectionChange('My note ');
      tick(200); // Part way through debounce

      // Unexpected store update (maybe from another source)
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'My note', created: Date.now() }],
      } as Metric);
      tick();

      // User's input should be preserved (trimmed values match)
      expect(component.inputText()).toBe('My note ');

      // User continues typing before debounce completes
      component.onReflectionChange('My note is ');
      tick(300); // Complete the debounce from first input
      tick(500); // Complete debounce from second input

      expect(component.inputText()).toBe('My note is ');

      flush();
    }));

    it('should correctly detect genuinely different external updates', fakeAsync(() => {
      createComponent();
      tick();

      // User types something
      component.onReflectionChange('Original text ');
      tick(500);

      // Simulate store reflecting the trimmed save
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Original text', created: Date.now() }],
      } as Metric);
      tick();

      // User's trailing space preserved
      expect(component.inputText()).toBe('Original text ');

      // Now external sync brings completely different content
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Synced from another device', created: Date.now() }],
      } as Metric);
      tick();

      // This IS a genuine external update - should override
      expect(component.inputText()).toBe('Synced from another device');

      flush();
    }));
  });

  describe('initial load', () => {
    it('should load existing reflection text on init', fakeAsync(() => {
      // Set up existing reflection before component creation
      metricForDay$.next({
        id: TODAY,
        ...DEFAULT_METRIC_FOR_DAY,
        reflections: [{ text: 'Existing note', created: Date.now() }],
      } as Metric);

      createComponent();
      tick();

      expect(component.inputText()).toBe('Existing note');

      flush();
    }));

    it('should start with empty input when no reflection exists', fakeAsync(() => {
      createComponent();
      tick();

      expect(component.inputText()).toBe('');

      flush();
    }));
  });
});
