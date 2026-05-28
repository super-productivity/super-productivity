import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';

import { MentionListComponent } from './mention-list.component';
import { Log } from '../../core/log';

/**
 * Regression #6123: active mention row must use --c-contrast on --c-primary.
 * Kept in a separate spec so the first detectChanges() runs after items are set
 * (avoids ExpressionChangedAfterItHasBeenCheckedError from the shared component spec).
 * Global mentions.scss is loaded via src/styles.scss in Karma.
 */
describe('MentionListComponent contrast (regression #6123)', () => {
  let component: MentionListComponent;
  let fixture: ComponentFixture<MentionListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MentionListComponent, CommonModule],
    }).compileComponents();

    fixture = TestBed.createComponent(MentionListComponent);
    component = fixture.componentInstance;
    spyOn(Log, 'warn');

    const host = fixture.nativeElement as HTMLElement;
    host.style.setProperty('--c-primary', 'rgb(255, 255, 255)');
    host.style.setProperty('--c-contrast', 'rgb(10, 10, 10)');
    host.style.setProperty('--text-color-most-intense', 'rgb(255, 255, 255)');
    host.style.setProperty('--text-color', 'rgb(200, 200, 200)');
    host.style.setProperty('--bg-lightest', 'rgb(40, 40, 40)');

    component.hidden = false;
    component.styleOff = false;
    component.labelKey = 'title';
    component.items = [{ title: 'Noite' }, { title: 'Dia' }] as any;
    component.activeIndex = 0;

    fixture.detectChanges();
    fixture.detectChanges();
  });

  it('should use --c-contrast for active row text when primary is light', () => {
    const activeLink = fixture.nativeElement.querySelector(
      '.mention-active > a',
    ) as HTMLElement | null;

    expect(activeLink).not.toBeNull();

    const computed = getComputedStyle(activeLink!);
    expect(computed.color).toBe('rgb(10, 10, 10)');
    expect(computed.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('should not use --text-color-most-intense for active row (would match light primary)', () => {
    const activeLink = fixture.nativeElement.querySelector(
      '.mention-active > a',
    ) as HTMLElement | null;

    expect(activeLink).not.toBeNull();

    const computed = getComputedStyle(activeLink!);
    expect(computed.color).not.toBe('rgb(255, 255, 255)');
  });

  it('should keep inactive rows on --text-color', () => {
    const inactiveLink = fixture.nativeElement.querySelector(
      'li:not(.mention-active) a.mention-item',
    ) as HTMLElement | null;

    expect(inactiveLink).not.toBeNull();

    expect(getComputedStyle(inactiveLink!).color).toBe('rgb(200, 200, 200)');
  });
});
