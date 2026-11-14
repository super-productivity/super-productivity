import { TestBed } from '@angular/core/testing';
import {
  ClipboardImageService,
  isCustomClipboardImageUrl,
  pathToFileUrl,
} from './clipboard-image.service';
import { SnackService } from '../snack/snack.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('pathToFileUrl', () => {
  it('prefixes a Unix absolute path correctly', () => {
    expect(pathToFileUrl('/home/user/img.png')).toBe('file:///home/user/img.png');
  });

  it('adds the third slash for a Windows drive path (forward slashes)', () => {
    expect(pathToFileUrl('C:/Users/user/img.png')).toBe('file:///C:/Users/user/img.png');
  });

  it('normalises Windows backslashes', () => {
    expect(pathToFileUrl('C:\\Users\\user\\img.png')).toBe(
      'file:///C:/Users/user/img.png',
    );
  });

  it('percent-encodes spaces in a Windows username', () => {
    expect(pathToFileUrl('C:\\Users\\John Doe\\clipboard-images\\clip.png')).toBe(
      'file:///C:/Users/John%20Doe/clipboard-images/clip.png',
    );
  });

  it('percent-encodes spaces in a Unix path', () => {
    expect(pathToFileUrl('/home/john doe/img.png')).toBe(
      'file:///home/john%20doe/img.png',
    );
  });
});

describe('isCustomClipboardImageUrl', () => {
  const folder = 'C:\\Users\\Acer\\AppData\\Roaming\\superProductivity\\Tes Gambar';
  const prefix = 'file:///C:/Users/Acer/AppData/Roaming/superProductivity/Tes%20Gambar';

  it('recognizes a saved image in the configured folder', () => {
    expect(isCustomClipboardImageUrl(`${prefix}/clip-123-abc.png`, folder)).toBeTrue();
  });

  it('rejects other folders, nested paths and remote URLs', () => {
    for (const url of [
      `${prefix}-other/clip-123-abc.png`,
      `${prefix}/nested/clip-123-abc.png`,
      `${prefix}/%2e%2e/clip-123-abc.png`,
      'file://host/share/clip-123-abc.png',
      `${prefix}/other.png`,
    ]) {
      expect(isCustomClipboardImageUrl(url, folder)).toBeFalse();
    }
  });
});

describe('ClipboardImageService', () => {
  let service: ClipboardImageService;

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [
      'clipboardImages',
    ]);
    globalConfigServiceSpy.clipboardImages.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        ClipboardImageService,
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
      ],
    });

    service = TestBed.inject(ClipboardImageService);
  });

  describe('resolveClipboardImageUrl', () => {
    it('returns null for an unrelated https URL', async () => {
      expect(
        await service.resolveClipboardImageUrl('https://example.com/img.png'),
      ).toBeNull();
    });

    it('returns null for a file:// URL outside clipboard-images', async () => {
      expect(
        await service.resolveClipboardImageUrl('file:///home/user/img.png'),
      ).toBeNull();
    });

    it('returns null for an empty string', async () => {
      expect(await service.resolveClipboardImageUrl('')).toBeNull();
    });
  });

  describe('hasResolvableImages', () => {
    it('is true when an indexeddb clipboard-image URL is present', () => {
      expect(
        service.hasResolvableImages('a ![x](indexeddb://clipboard-images/clip-1.png) b'),
      ).toBe(true);
    });

    it('is false for plain text and ordinary image links', () => {
      expect(service.hasResolvableImages('just some notes')).toBe(false);
      expect(service.hasResolvableImages('![x](https://example.com/img.png)')).toBe(
        false,
      );
    });

    // The check must be a superset of what resolveMarkdownImages rewrites: any
    // URL the resolver would touch has to be flagged, or the synchronous render
    // path would leave a permanently broken image.
    it('flags every indexeddb URL the resolver would rewrite', () => {
      const md = '![x](indexeddb://clipboard-images/abc-123)';
      expect(md.match(/indexeddb:\/\/clipboard-images\/[^)\s=]+/g)).not.toBeNull();
      expect(service.hasResolvableImages(md)).toBe(true);
    });
  });
});
