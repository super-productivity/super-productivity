import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { HelpSectionComponent } from './help-section.component';

describe('HelpSectionComponent', () => {
  let fixture: ComponentFixture<HelpSectionComponent>;
  const docsLink = (): HTMLAnchorElement | null =>
    fixture.nativeElement.querySelector('a.docs-link');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HelpSectionComponent, TranslateModule.forRoot()],
      providers: [provideNoopAnimations()],
    });
    fixture = TestBed.createComponent(HelpSectionComponent);
  });

  it('renders nothing while closed', () => {
    fixture.componentRef.setInput('docsUrl', 'https://super-productivity.com/docs/x/');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.help-text')).toBeNull();
  });

  it('links the docs page in a new tab when open', () => {
    fixture.componentRef.setInput('isShowHelp', true);
    fixture.componentRef.setInput(
      'docsUrl',
      'https://super-productivity.com/docs/reference/keyboard-shortcuts/',
    );
    fixture.detectChanges();
    const link = docsLink();
    expect(link?.href).toBe(
      'https://super-productivity.com/docs/reference/keyboard-shortcuts/',
    );
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener');
  });

  it('shows no docs link for a section without a docs page', () => {
    fixture.componentRef.setInput('isShowHelp', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.help-text')).not.toBeNull();
    expect(docsLink()).toBeNull();
  });
});
