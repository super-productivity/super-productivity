import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressBarComponent } from './progress-bar.component';

describe('ProgressBarComponent', () => {
  let fixture: ComponentFixture<ProgressBarComponent>;
  let component: ProgressBarComponent;
  let hostEl: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressBarComponent);
    component = fixture.componentInstance;
    hostEl = fixture.nativeElement;
  });

  it('should hide progress at or below one percent by default', () => {
    component.progress = 1;

    expect(hostEl.style.visibility).toBe('hidden');
  });

  it('should show and clamp regular progress above one hundred percent', () => {
    component.progress = 150;

    expect(hostEl.style.visibility).toBe('visible');
    expect(hostEl.style.width).toBe('100%');
  });

  it('should keep the host visible and full-width for always-visible zero progress', () => {
    component.isAlwaysVisible = true;
    component.progress = 0;

    expect(hostEl.style.visibility).toBe('visible');
    expect(hostEl.style.width).toBe('100%');
    expect(hostEl.style.getPropertyValue('--progress-bar-value')).toBe('0%');
  });

  it('should store clamped progress in the css variable for always-visible mode', () => {
    component.isAlwaysVisible = true;
    component.progress = 150;

    expect(hostEl.style.visibility).toBe('visible');
    expect(hostEl.style.width).toBe('100%');
    expect(hostEl.style.getPropertyValue('--progress-bar-value')).toBe('100%');
  });
});
