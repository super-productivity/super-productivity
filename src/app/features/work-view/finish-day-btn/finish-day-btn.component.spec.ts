import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { FinishDayBtnComponent } from './finish-day-btn.component';

describe('FinishDayBtnComponent', () => {
  let fixture: ComponentFixture<FinishDayBtnComponent>;

  const btnEl = (): HTMLButtonElement =>
    fixture.debugElement.query(By.css('.e2e-finish-day')).nativeElement;

  /** The appearance as MatButton reports it, rather than its internal classes. */
  const appearance = (): string =>
    fixture.debugElement.query(By.directive(MatButton)).componentInstance.appearance;

  const setHasDoneTasks = (value: boolean): void => {
    fixture.componentRef.setInput('hasDoneTasks', value);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinishDayBtnComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(FinishDayBtnComponent);
    fixture.componentRef.setInput('hasDoneTasks', false);
    fixture.detectChanges();
  });

  it('renders an outlined button while there are no done tasks', () => {
    expect(appearance()).toBe('outlined');
    expect(btnEl().classList).toContain('mat-unthemed');
  });

  it('renders a filled primary button once there are done tasks', () => {
    setHasDoneTasks(true);

    expect(appearance()).toBe('filled');
    expect(btnEl().classList).toContain('mat-primary');
  });

  // MatButton applies the appearance by mutating classList imperatively while
  // `color` is an Angular [class] host binding. Flipping back is the direction
  // where those two class-management mechanisms could diverge.
  it('restores the outlined appearance when the flip reverses', () => {
    setHasDoneTasks(true);
    setHasDoneTasks(false);

    expect(appearance()).toBe('outlined');
    expect(btnEl().classList).toContain('mat-unthemed');
    expect(btnEl().classList).not.toContain('mat-primary');
  });

  // The button is a routerLink: an @if/@else swap between the two appearances
  // would re-create the node whenever hasDoneTasks() flips, and a click landing
  // in that window is dropped before the link is wired (CI run 33189475377).
  it('keeps the same DOM node across the flip', () => {
    const before = btnEl();

    setHasDoneTasks(true);

    expect(btnEl()).toBe(before);
  });

  // The @if/@else pair dropped keyboard focus on every flip; one node keeps it.
  it('keeps focus across the flip', () => {
    btnEl().focus();

    setHasDoneTasks(true);

    expect(document.activeElement).toBe(btnEl());
  });
});
