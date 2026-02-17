import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskTitleComponent } from './task-title.component';
import { TranslateModule } from '@ngx-translate/core';

describe('TaskTitleComponent', () => {
  let component: TaskTitleComponent;
  let fixture: ComponentFixture<TaskTitleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskTitleComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskTitleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('displayHtml - XSS Protection', () => {
    it('should HTML-escape content in markdown link titles, preventing XSS', () => {
      component.tmpValue.set('Task [<img src=x onerror=alert(1)>](https://example.com)');
      const html = component.displayHtml();
      const htmlString = html.toString();

      // The <img> tag is escaped - it cannot execute as an HTML element
      expect(htmlString).not.toContain('<img');
      expect(htmlString).toContain('&lt;img');
    });

    it('should HTML-escape script tags in plain URL display text and href', () => {
      component.tmpValue.set('Task https://evil.com/<script>alert(1)</script>');
      const html = component.displayHtml();
      const htmlString = html.toString();

      // Script tags are escaped in both href and display text - cannot execute
      expect(htmlString).not.toContain('<script>');
      expect(htmlString).toContain('&lt;script&gt;');
      expect(htmlString).toContain('https://evil.com/');
    });

    it('should escape quote characters in href attributes to prevent attribute breakout', () => {
      component.tmpValue.set('Task [link](https://evil.com/"onmouseover="alert(1))');
      const html = component.displayHtml();
      const htmlString = html.toString();

      // Quotes escaped with &quot; to prevent breaking out of href="..."
      expect(htmlString).toContain('&quot;onmouseover=&quot;');
      expect(htmlString).toContain(
        'href="https://evil.com/&quot;onmouseover=&quot;alert(1"',
      );
    });

    it('should escape ampersands in URLs', () => {
      component.tmpValue.set('Task https://example.com?a=1&b=2');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).toContain('&amp;');
    });

    it('should return plain text as-is when no URLs are present', () => {
      component.tmpValue.set('Just plain text task');
      const result = component.displayHtml();

      expect(result).toBe('Just plain text task');
    });

    it('should explicitly reject javascript: URLs in markdown links', () => {
      component.tmpValue.set('[Click](javascript:alert(1))');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).not.toContain('javascript:');
      expect(htmlString).not.toContain('<a ');
    });

    it('should explicitly reject data: URLs', () => {
      component.tmpValue.set('[Click](data:text/html,<script>alert(1)</script>)');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).not.toContain('data:');
      expect(htmlString).not.toContain('<a ');
    });

    it('should explicitly reject vbscript: URLs', () => {
      component.tmpValue.set('[Click](vbscript:msgbox(1))');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).not.toContain('vbscript:');
      expect(htmlString).not.toContain('<a ');
    });

    it('should allow safe protocols (http, https, file)', () => {
      component.tmpValue.set(
        '[HTTP](http://example.com) [HTTPS](https://example.com) [FILE](file:///path)',
      );
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).toContain('http://example.com');
      expect(htmlString).toContain('https://example.com');
      expect(htmlString).toContain('file:///path');
      expect((htmlString.match(/<a /g) || []).length).toBe(3);
    });
  });

  describe('displayHtml - Mixed Content', () => {
    it('should render both markdown links and plain URLs in the same title', () => {
      component.tmpValue.set('Review [docs](https://docs.com) and https://example.com');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).toContain('href="https://docs.com"');
      expect(htmlString).toContain('>docs</a>');
      expect(htmlString).toContain('href="https://example.com"');
      expect(htmlString).toContain('>https://example.com</a>');
      expect((htmlString.match(/<a /g) || []).length).toBe(2);
    });

    it('should not double-process URLs that are already in markdown links', () => {
      component.tmpValue.set('[https://example.com](https://example.com)');
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect((htmlString.match(/<a /g) || []).length).toBe(1);
      expect(htmlString).toContain('href="https://example.com"');
      expect(htmlString).toContain('>https://example.com</a>');
    });

    it('should handle multiple markdown links and multiple plain URLs', () => {
      component.tmpValue.set(
        'Check [docs](https://docs.com) and [api](https://api.com), also see https://example.com and https://github.com',
      );
      const html = component.displayHtml();
      const htmlString = html.toString();

      expect((htmlString.match(/<a /g) || []).length).toBe(4);
      expect(htmlString).toContain('href="https://docs.com"');
      expect(htmlString).toContain('href="https://api.com"');
      expect(htmlString).toContain('href="https://example.com"');
      expect(htmlString).toContain('href="https://github.com"');
    });
  });

  describe('readonly mode', () => {
    it('should not enter editing mode when clicked in readonly mode', () => {
      component.readonly = true;
      component.tmpValue.set('Test task with https://example.com');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { button: 0 });
      component.onMouseDown(mouseEvent);

      expect(component.isEditing()).toBe(false);
    });

    it('should not allow focusInput in readonly mode', () => {
      component.readonly = true;
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      component.focusInput();

      expect(component.isEditing()).toBe(false);
    });

    it('should still render links in readonly mode', () => {
      component.readonly = true;
      component.tmpValue.set('Check https://example.com for details');
      fixture.detectChanges();

      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).toContain('href="https://example.com"');
      expect(htmlString).toContain('<a ');
    });

    it('should allow clicking links in readonly mode without entering edit mode', () => {
      component.readonly = true;
      component.tmpValue.set('Visit https://example.com');
      fixture.detectChanges();

      const anchorClickEvent = new MouseEvent('mousedown', { button: 0 });
      Object.defineProperty(anchorClickEvent, 'target', {
        value: document.createElement('a'),
        enumerable: true,
      });

      component.onMouseDown(anchorClickEvent);

      expect(component.isEditing()).toBe(false);
    });

    it('should allow editing when readonly is false', () => {
      component.readonly = false;
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      component.onMouseDown(mouseEvent);

      expect(component.isEditing()).toBe(true);
    });

    it('should not stop mousedown propagation in readonly mode (allows drag)', () => {
      component.readonly = true;
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(mouseEvent, 'stopPropagation');
      component.onMouseDown(mouseEvent);

      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });

    it('should stop mousedown propagation when entering edit mode', () => {
      component.readonly = false;
      component.tmpValue.set('Test task');
      fixture.detectChanges();

      const mouseEvent = new MouseEvent('mousedown', { bubbles: true, button: 0 });
      Object.defineProperty(mouseEvent, 'target', {
        value: document.createElement('span'),
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(mouseEvent, 'stopPropagation');
      component.onMouseDown(mouseEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(component.isEditing()).toBe(true);
    });
  });

  describe('link click propagation', () => {
    it('should stop click propagation when clicking on a link', () => {
      component.tmpValue.set('Visit https://example.com for info');
      fixture.detectChanges();

      const link = document.createElement('a');
      link.href = 'https://example.com';

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: link,
        enumerable: true,
      });

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should stop click propagation when clicking inside a link', () => {
      component.tmpValue.set('Check [documentation](https://docs.example.com)');
      fixture.detectChanges();

      const link = document.createElement('a');
      link.href = 'https://docs.example.com';
      const span = document.createElement('span');
      span.textContent = 'documentation';
      link.appendChild(span);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: span,
        enumerable: true,
      });
      spyOn(span, 'closest').and.returnValue(link);

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should not stop click propagation when clicking on non-link text', () => {
      component.tmpValue.set('Just plain text task');
      fixture.detectChanges();

      const span = document.createElement('span');
      span.textContent = 'plain text';

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', {
        value: span,
        enumerable: true,
      });
      spyOn(span, 'closest').and.returnValue(null);

      const stopPropagationSpy = spyOn(clickEvent, 'stopPropagation');
      component.onClick(clickEvent);

      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });
  });

  describe('ReDoS protection', () => {
    it('should handle extremely long URLs without performance degradation', () => {
      const prefix = 'https://example.com/';
      const longPath = 'a'.repeat(1990 - prefix.length);
      const longUrl = `${prefix}${longPath}`;
      component.tmpValue.set(`Check ${longUrl} for details`);

      const startTime = performance.now();
      const html = component.displayHtml();
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(html.toString()).toContain('href=');
    });

    it('should handle URLs at exactly 2000 characters', () => {
      const prefix = 'https://example.com/';
      const longPath = 'a'.repeat(2000 - prefix.length);
      const longUrl = `${prefix}${longPath}`;
      component.tmpValue.set(longUrl);

      const html = component.displayHtml();
      const htmlString = html.toString();

      expect(htmlString).toContain('href=');
      expect(htmlString).toContain(longUrl);
    });
  });
});
