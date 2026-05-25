import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { MaterialIconsLoaderService } from './material-icons-loader.service';
import { BodyClass } from '../app.constants';

const MATERIAL_ICONS_FONT = '24px "Material Symbols Outlined"';
const MATERIAL_ICONS_FONT_READY_TIMEOUT_MS = 3000;

describe('MaterialIconsLoaderService', () => {
  let service: MaterialIconsLoaderService;
  let originalFonts: FontFaceSet | undefined;

  beforeEach(() => {
    originalFonts = document.fonts;
    document.body.classList.remove(BodyClass.isMaterialSymbolsLoaded);
    TestBed.configureTestingModule({});
    service = TestBed.inject(MaterialIconsLoaderService);
  });

  afterEach(() => {
    setDocumentFonts(originalFonts);
    document.body.classList.remove(BodyClass.isMaterialSymbolsLoaded);
  });

  it('should load icons on first call', async () => {
    const icons = await service.loadIcons();
    expect(icons).toBeDefined();
    expect(icons.length).toBeGreaterThan(0);
  });

  it('should return cached icons on subsequent calls', async () => {
    const icons1 = await service.loadIcons();
    const icons2 = await service.loadIcons();
    expect(icons1).toBe(icons2); // Same reference
  });

  it('should handle concurrent load requests', async () => {
    const [icons1, icons2] = await Promise.all([
      service.loadIcons(),
      service.loadIcons(),
    ]);
    expect(icons1).toBe(icons2);
  });

  it('should reveal icons when FontFaceSet is unavailable', async () => {
    setDocumentFonts(undefined);

    await service.ensureFontReady();

    expect(
      document.body.classList.contains(BodyClass.isMaterialSymbolsLoaded),
    ).toBeTrue();
  });

  it('should wait for the material symbols font before revealing icons', async () => {
    const load = jasmine.createSpy('load').and.resolveTo([]);
    setDocumentFonts({ load } as unknown as FontFaceSet);

    await service.ensureFontReady();

    expect(load).toHaveBeenCalledWith(MATERIAL_ICONS_FONT);
    expect(
      document.body.classList.contains(BodyClass.isMaterialSymbolsLoaded),
    ).toBeTrue();
  });

  it('should reveal icons if the font readiness probe stalls', fakeAsync(() => {
    const load = jasmine
      .createSpy('load')
      .and.returnValue(new Promise<FontFace[]>(() => undefined));
    setDocumentFonts({ load } as unknown as FontFaceSet);
    let didResolve = false;

    service.ensureFontReady().then(() => {
      didResolve = true;
    });
    tick(MATERIAL_ICONS_FONT_READY_TIMEOUT_MS);
    flushMicrotasks();

    expect(didResolve).toBeTrue();
    expect(
      document.body.classList.contains(BodyClass.isMaterialSymbolsLoaded),
    ).toBeTrue();
  }));

  it('should reveal icons if the font readiness probe rejects', async () => {
    const load = jasmine
      .createSpy('load')
      .and.returnValue(Promise.reject(new Error('font failed')));
    setDocumentFonts({ load } as unknown as FontFaceSet);

    await service.ensureFontReady();

    expect(
      document.body.classList.contains(BodyClass.isMaterialSymbolsLoaded),
    ).toBeTrue();
  });
});

const setDocumentFonts = (fonts: FontFaceSet | undefined): void => {
  Object.defineProperty(document, 'fonts', {
    value: fonts,
    configurable: true,
  });
};
