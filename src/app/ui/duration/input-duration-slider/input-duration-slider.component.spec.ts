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
});
