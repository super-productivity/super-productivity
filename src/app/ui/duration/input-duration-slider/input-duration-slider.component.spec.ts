import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { InputDurationSliderComponent } from './input-duration-slider.component';

describe('InputDurationSliderComponent', () => {
  let component: InputDurationSliderComponent;
  let fixture: ComponentFixture<InputDurationSliderComponent>;

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const FIFTEEN_MINUTES = 15 * MINUTE;
  const THIRTY_MINUTES = 30 * MINUTE;
  const FIFTY_FIVE_MINUTES = 55 * MINUTE;
  const ONE_HOUR_AND_FIFTEEN_MINUTES = HOUR + FIFTEEN_MINUTES;
  const ONE_HOUR_AND_THIRTY_MINUTES = HOUR + THIRTY_MINUTES;
  const ONE_HOUR_AND_FIFTY_FIVE_MINUTES = HOUR + FIFTY_FIVE_MINUTES;

  const handleEl = (): HTMLElement =>
    fixture.nativeElement.querySelector('.handle-wrapper') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        InputDurationSliderComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InputDurationSliderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should update handle rotation, minutes, and hour dots from a millisecond value', () => {
    component.setRotationFromValue(ONE_HOUR_AND_THIRTY_MINUTES);

    expect(component.minutesBefore()).toBe(30);
    expect(component.dots().length).toBe(1);
    expect(handleEl().style.transform).toBe('rotate(180deg)');
  });

  it('should clamp invalid input values to zero when syncing rotation', () => {
    component.setRotationFromValue(Number.NaN);

    expect(component.minutesBefore()).toBe(0);
    expect(component.dots().length).toBe(0);
    expect(handleEl().style.transform).toBe('rotate(0deg)');
  });

  it('should emit the model value represented by a new rotation', () => {
    const emittedValues: number[] = [];
    const sub = component.modelChange.subscribe((value) => emittedValues.push(value));

    component._model.set(HOUR);
    component.minutesBefore.set(0);

    component.setValueFromRotation(90);

    expect(component._model()).toBe(ONE_HOUR_AND_FIFTEEN_MINUTES);
    expect(component.minutesBefore()).toBe(15);
    expect(component.dots().length).toBe(1);
    expect(handleEl().style.transform).toBe('rotate(90deg)');
    expect(emittedValues).toEqual([ONE_HOUR_AND_FIFTEEN_MINUTES]);

    sub.unsubscribe();
  });

  it('should roll over to the next hour when rotation crosses backward over zero', () => {
    const emittedValues: number[] = [];
    const sub = component.modelChange.subscribe((value) => emittedValues.push(value));

    component._model.set(ONE_HOUR_AND_FIFTY_FIVE_MINUTES);
    component.minutesBefore.set(55);

    component.setValueFromRotation(0);

    expect(component._model()).toBe(2 * HOUR);
    expect(component.minutesBefore()).toBe(0);
    expect(component.dots().length).toBe(2);
    expect(handleEl().style.transform).toBe('rotate(0deg)');
    expect(emittedValues).toEqual([2 * HOUR]);

    sub.unsubscribe();
  });

  describe('flexible increment (hybrid drag)', () => {
    // Apply a single drag tick at the given raw pointer angle and return the
    // value emitted by modelChange.
    const drag = (degrees: number): number => {
      let emitted = Number.NaN;
      const sub = component.modelChange.subscribe((v) => (emitted = v));
      component.setValueFromRotation(degrees);
      sub.unsubscribe();
      return emitted;
    };

    beforeEach(() => {
      fixture.componentRef.setInput('useFlexibleIncrement', true);
      fixture.detectChanges();
    });

    it('Mode A (<1h): 5-min snap at 1° = 1/6 min', () => {
      component.setRotationFromValue(THIRTY_MINUTES); // raw angle 180, accumulator 30
      // +30° at 1/6 min/° = +5 min
      expect(drag(210)).toBe(35 * MINUTE);
      expect(component._model()).toBe(35 * MINUTE);
    });

    it('Mode B (≥1h): 15-min snap at 1° = 1 min', () => {
      component.setRotationFromValue(ONE_HOUR_AND_FIFTEEN_MINUTES); // raw angle 15, accumulator 75
      // +15° at 1 min/° = +15 min
      expect(drag(30)).toBe(ONE_HOUR_AND_THIRTY_MINUTES);
    });

    it('anchors exactly to 1h when crossing the A→B boundary', () => {
      component.setRotationFromValue(FIFTY_FIVE_MINUTES); // raw angle 330, accumulator 55
      // a forward drag whose rounded value reaches ≥60 snaps to exactly 60
      expect(drag(355)).toBe(HOUR);
      expect(component._model()).toBe(HOUR);
    });

    it('anchors to 55min crossing the B→A boundary (−delta via ±180° wrap)', () => {
      component.setRotationFromValue(HOUR); // raw angle 0, accumulator 60
      // 0° → 350° is a −10° move across the seam, not +350°
      expect(drag(350)).toBe(FIFTY_FIVE_MINUTES);
      expect(component._model()).toBe(FIFTY_FIVE_MINUTES);
    });

    it('reads a seam-crossing drag as a small forward delta (+wrap)', () => {
      component.setRotationFromValue(FIFTY_FIVE_MINUTES); // raw angle 330, accumulator 55
      // 330° → 10° is a +40° move across the seam, not −320°
      expect(drag(10)).toBe(HOUR);
    });
  });
});
