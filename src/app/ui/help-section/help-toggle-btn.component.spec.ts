import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { HelpToggleBtnComponent } from './help-toggle-btn.component';

@Component({
  template: `<div (click)="lastClick = $event">
    <help-toggle-btn [(isOpen)]="isOpen" />
  </div>`,
  imports: [HelpToggleBtnComponent],
})
class HostComponent {
  readonly isOpen = signal(false);
  lastClick?: Event;
}

describe('HelpToggleBtnComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let btn: HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    btn = fixture.nativeElement.querySelector('button');
  });

  it('opens and closes the help', () => {
    btn.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isOpen()).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    btn.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isOpen()).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  // A collapsible header skips handled clicks; a stopped click would also hide
  // it from document listeners such as menus closing on an outside click.
  it('marks its click handled without stopping it', () => {
    btn.click();
    const click = fixture.componentInstance.lastClick;
    expect(click).toBeDefined();
    expect(click?.defaultPrevented).toBe(true);
  });
});
