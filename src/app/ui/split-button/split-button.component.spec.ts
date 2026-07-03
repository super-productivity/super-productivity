import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatMenuModule } from '@angular/material/menu';
import { SplitButtonComponent } from './split-button.component';

// Host wraps the component so the required `menu` input can be bound to a real
// <mat-menu> and the projected default-action content is provided. Signal-backed
// state so writes mark the host dirty under zoneless change detection.
@Component({
  standalone: true,
  imports: [SplitButtonComponent, MatMenuModule],
  template: `
    <split-button
      [menu]="menu"
      [disabled]="disabled()"
      [triggerLabel]="triggerLabel()"
      [mainLabel]="mainLabel()"
      (mainClick)="onMainClick()"
    >
      <span class="projected-content">Snooze 10m</span>
    </split-button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item>Option</button>
    </mat-menu>
  `,
})
class HostComponent {
  readonly disabled = signal(false);
  readonly triggerLabel = signal('');
  readonly mainLabel = signal('');
  mainClickCount = 0;

  onMainClick(): void {
    this.mainClickCount++;
  }
}

describe('SplitButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const mainBtn = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.split-btn-main');
  const triggerBtn = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.split-btn-trigger');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders both halves and projects the default-action content', () => {
    expect(mainBtn()).toBeTruthy();
    expect(triggerBtn()).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.projected-content')?.textContent,
    ).toContain('Snooze 10m');
  });

  it('emits mainClick when the default-action half is clicked', () => {
    mainBtn().click();
    expect(host.mainClickCount).toBe(1);
  });

  it('wires the trigger half to open the passed-in menu', () => {
    const trigger = triggerBtn();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('disables both halves when [disabled] is true', () => {
    host.disabled.set(true);
    fixture.detectChanges();
    expect(mainBtn().disabled).toBe(true);
    expect(triggerBtn().disabled).toBe(true);
  });

  it('exposes triggerLabel as the trigger aria-label, and omits it when empty', () => {
    // No translations loaded, so the translate pipe returns the key verbatim.
    host.triggerLabel.set('F.TASK.D_REMINDER_VIEW.MORE_ACTIONS');
    fixture.detectChanges();
    expect(triggerBtn().getAttribute('aria-label')).toBe(
      'F.TASK.D_REMINDER_VIEW.MORE_ACTIONS',
    );

    host.triggerLabel.set('');
    fixture.detectChanges();
    expect(triggerBtn().getAttribute('aria-label')).toBeNull();
  });

  it('exposes the resolved mainLabel as the main aria-label, and omits it when empty', () => {
    // mainLabel is a resolved string (caller translates), so it is bound as-is.
    host.mainLabel.set('Snooze 10m');
    fixture.detectChanges();
    expect(mainBtn().getAttribute('aria-label')).toBe('Snooze 10m');

    host.mainLabel.set('');
    fixture.detectChanges();
    expect(mainBtn().getAttribute('aria-label')).toBeNull();
  });
});
