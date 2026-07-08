import { TestBed } from '@angular/core/testing';
import { EmlDropDirective } from './eml-drop.directive';
import { EmlDropService } from './eml-drop.service';

const makeFile = (name: string, type = ''): File => new File([''], name, { type });

const makeDropEvent = (files: File[]): jasmine.SpyObj<DragEvent> => {
  const ev = jasmine.createSpyObj('DragEvent', ['preventDefault', 'stopPropagation']);
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files },
    writable: true,
  });
  return ev;
};

describe('EmlDropDirective', () => {
  let directive: EmlDropDirective;
  let emlDropService: jasmine.SpyObj<EmlDropService>;

  beforeEach(() => {
    emlDropService = jasmine.createSpyObj('EmlDropService', ['createTaskFromEml']);
    emlDropService.createTaskFromEml.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [{ provide: EmlDropService, useValue: emlDropService }],
    });

    directive = TestBed.runInInjectionContext(() => new EmlDropDirective());
  });

  it('should prevent default and stop propagation on drop', async () => {
    const ev = makeDropEvent([]);

    await directive.onDrop(ev);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it('should create a task for a dropped .eml file', async () => {
    const file = makeFile('mail.eml');
    const ev = makeDropEvent([file]);

    await directive.onDrop(ev);

    expect(emlDropService.createTaskFromEml).toHaveBeenCalledOnceWith(file);
  });

  it('should ignore dropped files that are not .eml', async () => {
    const ev = makeDropEvent([makeFile('doc.pdf', 'application/pdf')]);

    await directive.onDrop(ev);

    expect(emlDropService.createTaskFromEml).not.toHaveBeenCalled();
  });

  it('should handle multiple dropped files, only processing the .eml ones', async () => {
    const emlFile = makeFile('mail.eml');
    const otherFile = makeFile('notes.txt', 'text/plain');
    const ev = makeDropEvent([otherFile, emlFile]);

    await directive.onDrop(ev);

    expect(emlDropService.createTaskFromEml).toHaveBeenCalledOnceWith(emlFile);
  });

  it('should not throw and not call the service when no files are dropped', async () => {
    const ev = makeDropEvent([]);

    await expectAsync(directive.onDrop(ev)).toBeResolved();

    expect(emlDropService.createTaskFromEml).not.toHaveBeenCalled();
  });

  it('should not throw when dataTransfer is missing', async () => {
    const ev = jasmine.createSpyObj('DragEvent', ['preventDefault', 'stopPropagation']);
    Object.defineProperty(ev, 'dataTransfer', { value: undefined, writable: true });

    await expectAsync(directive.onDrop(ev)).toBeResolved();

    expect(emlDropService.createTaskFromEml).not.toHaveBeenCalled();
  });
});
