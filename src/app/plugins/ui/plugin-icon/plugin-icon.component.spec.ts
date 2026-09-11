import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PluginIconComponent } from './plugin-icon.component';
import { PluginService } from '../../plugin.service';

/**
 * The component binds plugin supplied markup to `[innerHTML]`, so these specs assert on
 * the DOM the browser actually builds from it rather than on the string itself.
 */
describe('PluginIconComponent', () => {
  const PLUGIN_ID = 'test-plugin';

  const renderIcon = (iconContent: string): ComponentFixture<PluginIconComponent> => {
    const icons = signal<ReadonlyMap<string, string>>(
      new Map([[PLUGIN_ID, iconContent]]),
    );
    TestBed.configureTestingModule({
      imports: [PluginIconComponent],
      providers: [
        { provide: PluginService, useValue: { getPluginIconsSignal: () => icons } },
      ],
    });
    const fixture = TestBed.createComponent(PluginIconComponent);
    fixture.componentRef.setInput('pluginId', PLUGIN_ID);
    fixture.detectChanges();
    return fixture;
  };

  it('renders a benign plugin icon', () => {
    const el: HTMLElement = renderIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2"></path></svg>',
    ).nativeElement;

    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('path')?.getAttribute('d')).toBe('M1 2');
  });

  it('falls back to the mat-icon when the content is not an SVG', () => {
    const el: HTMLElement = renderIcon('<div>nope</div>').nativeElement;

    expect(el.querySelector('.plugin-svg-icon')).toBeNull();
    expect(el.querySelector('mat-icon')).not.toBeNull();
  });

  it('falls back to the mat-icon when nothing drawable survives sanitization', () => {
    // `SafeHtml` is an object, so an empty-but-valid `<svg>` would satisfy the template's
    // `@if` and paint a blank box instead of the fallback.
    const el: HTMLElement = renderIcon(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBOR"></image></svg>',
    ).nativeElement;

    expect(el.querySelector('.plugin-svg-icon')).toBeNull();
    expect(el.querySelector('mat-icon')).not.toBeNull();
  });

  it('does not render smuggled markup from a CDATA payload', () => {
    const el: HTMLElement = renderIcon(
      '<svg xmlns="http://www.w3.org/2000/svg"><desc><![CDATA[><img src=x onerror="window.alert(1)">]]></desc></svg>',
    ).nativeElement;

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[onerror]')).toBeNull();
  });

  it('strips event handlers but keeps the drawable shapes', () => {
    const el: HTMLElement = renderIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.alert(1)"><circle r="4" onclick="window.alert(1)"></circle></svg>',
    ).nativeElement;

    expect(el.querySelector('svg')?.getAttribute('onload')).toBeNull();
    expect(el.querySelector('circle')?.getAttribute('onclick')).toBeNull();
    expect(el.querySelector('circle')?.getAttribute('r')).toBe('4');
  });
});
