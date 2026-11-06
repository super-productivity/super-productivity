import { TestBed } from '@angular/core/testing';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import { SnackService } from '../../../core/snack/snack.service';
import { AddTaskBarImagesService } from './add-task-bar-images.service';

describe('AddTaskBarImagesService', () => {
  let service: AddTaskBarImagesService;
  let clipboard: jasmine.SpyObj<ClipboardImageService>;
  let snack: jasmine.SpyObj<SnackService>;

  const paste = (names: string[], text = ''): ClipboardEvent => {
    const data = new DataTransfer();
    names.forEach((name) =>
      data.items.add(new File(['image'], name, { type: 'image/png' })),
    );
    if (text) data.setData('text/plain', text);
    return new ClipboardEvent('paste', { clipboardData: data, cancelable: true });
  };
  const settled = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    clipboard = jasmine.createSpyObj('ClipboardImageService', [
      'saveImage',
      'resolveClipboardImageUrl',
    ]);
    clipboard.saveImage.and.callFake(
      async (file: Blob) => `indexeddb://${(file as File).name}`,
    );
    clipboard.resolveClipboardImageUrl.and.callFake(
      async (path: string) => `blob:${path}`,
    );
    snack = jasmine.createSpyObj('SnackService', ['open']);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClipboardImageService, useValue: clipboard },
        { provide: SnackService, useValue: snack },
      ],
    });
    service = TestBed.inject(AddTaskBarImagesService);
  });

  it('appends multiple pastes in order and keeps resolved URLs out of saved attachments', async () => {
    const event = paste(['one.png', 'two.png']);
    expect(service.paste(event)).toBeTrue();
    expect(event.defaultPrevented).toBeTrue();
    expect(service.isLoading()).toBeTrue();
    service.paste(paste(['three.png']));
    await settled();
    expect(service.isLoading()).toBeFalse();
    expect(service.attachments().map((image) => image.path)).toEqual([
      'indexeddb://one.png',
      'indexeddb://two.png',
      'indexeddb://three.png',
    ]);
    service.remove(service.images()[1].id);
    expect(service.attachments().length).toBe(2);
    expect(TestBed.inject(AddTaskBarImagesService).images().length).toBe(2);
    service.clear();
    expect(service.attachments()).toEqual([]);
  });

  it('leaves plain and mixed text/image paste alone', () => {
    const event = paste(['one.png'], 'copied text');
    expect(service.paste(event)).toBeFalse();
    expect(service.paste(paste([], 'text'))).toBeFalse();
    expect(event.defaultPrevented).toBeFalse();
    expect(clipboard.saveImage).not.toHaveBeenCalled();
  });

  it('does not restore images removed while saving', async () => {
    let finish!: (path: string) => void;
    clipboard.saveImage.and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    service.paste(paste(['one.png']));
    service.remove(service.images()[0].id);
    finish('indexeddb://one.png');
    await settled();
    expect(service.images()).toEqual([]);
  });

  it('reports failure and allows another paste', async () => {
    clipboard.saveImage.and.rejectWith(new Error('storage failed'));
    service.paste(paste(['one.png']));
    await settled();
    expect(service.images()).toEqual([]);
    expect(service.isLoading()).toBeFalse();
    expect(snack.open).toHaveBeenCalled();
  });
});
