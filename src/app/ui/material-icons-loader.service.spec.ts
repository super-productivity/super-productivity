import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { MaterialIconsLoaderService } from './material-icons-loader.service';
import { BodyClass } from '../app.constants';

const MATERIAL_ICONS_FONT = '24px "Material Symbols Outlined"';
const MATERIAL_ICONS_FONT_READY_TIMEOUT_MS = 3000;

describe('MaterialIconsLoaderService', () => {
  let service: MaterialIconsLoaderService;
  let originalFonts: FontFaceSet | undefined;
  let originalAndroidInterfaceDescriptor: PropertyDescriptor | undefined;
  let testHost: HTMLDivElement;

  beforeEach(() => {
    originalFonts = document.fonts;
    originalAndroidInterfaceDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'SUPAndroid',
    );
    document.body.classList.remove(BodyClass.isMaterialSymbolsLoaded);
    document.body.classList.remove(BodyClass.hasAndroidWebViewTextZoom);
    document.documentElement.style.removeProperty('--android-webview-icon-scale');
    testHost = document.createElement('div');
    document.body.append(testHost);
    TestBed.configureTestingModule({});
    service = TestBed.inject(MaterialIconsLoaderService);
  });

  afterEach(() => {
    setDocumentFonts(originalFonts);
    restoreAndroidInterface(originalAndroidInterfaceDescriptor);
    document.body.classList.remove(BodyClass.isMaterialSymbolsLoaded);
    document.body.classList.remove(BodyClass.hasAndroidWebViewTextZoom);
    document.documentElement.style.removeProperty('--android-webview-icon-scale');
    testHost.remove();
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

  it('counter-scales only Android font icons when system text zoom is increased', async () => {
    setDocumentFonts(undefined);
    setAndroidTextZoom(130);
    const fontIcon = document.createElement('mat-icon');
    fontIcon.setAttribute('data-mat-icon-type', 'font');
    fontIcon.style.transform = 'rotate(45deg)';
    const rawFontIcon = document.createElement('span');
    rawFontIcon.classList.add('material-icons');
    const pseudoFontIcon = document.createElement('div');
    pseudoFontIcon.classList.add('sync-warning');
    const inlineFontIcon = document.createElement('mat-icon');
    inlineFontIcon.setAttribute('data-mat-icon-type', 'font');
    inlineFontIcon.classList.add('material-icons', 'mat-icon-inline');
    const svgIcon = document.createElement('mat-icon');
    svgIcon.setAttribute('data-mat-icon-type', 'svg');
    const ordinaryText = document.createElement('span');
    testHost.append(
      fontIcon,
      rawFontIcon,
      pseudoFontIcon,
      inlineFontIcon,
      svgIcon,
      ordinaryText,
    );

    await service.ensureFontReady();

    expect(
      document.body.classList.contains(BodyClass.hasAndroidWebViewTextZoom),
    ).toBeTrue();
    expect(parseFloat(getComputedStyle(fontIcon).scale)).toBeCloseTo(100 / 130, 5);
    expect(getComputedStyle(fontIcon).transform).not.toBe('none');
    expect(parseFloat(getComputedStyle(rawFontIcon).scale)).toBeCloseTo(100 / 130, 5);
    expect(parseFloat(getComputedStyle(pseudoFontIcon, '::before').scale)).toBeCloseTo(
      100 / 130,
      5,
    );
    expect(getComputedStyle(inlineFontIcon).scale).toBe('none');
    expect(getComputedStyle(svgIcon).scale).toBe('none');
    expect(getComputedStyle(ordinaryText).scale).toBe('none');
  });

  it('does not compensate the default Android text zoom', async () => {
    setDocumentFonts(undefined);
    setAndroidTextZoom(100);

    await service.ensureFontReady();

    expect(
      document.body.classList.contains(BodyClass.hasAndroidWebViewTextZoom),
    ).toBeFalse();
    expect(
      document.documentElement.style.getPropertyValue('--android-webview-icon-scale'),
    ).toBe('');
  });

  it('keeps icons usable if the Android text zoom bridge throws', async () => {
    setDocumentFonts(undefined);
    setThrowingAndroidTextZoom();

    await expectAsync(service.ensureFontReady()).toBeResolved();

    expect(
      document.body.classList.contains(BodyClass.hasAndroidWebViewTextZoom),
    ).toBeFalse();
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

const setAndroidTextZoom = (textZoom: number): void => {
  Object.defineProperty(window, 'SUPAndroid', {
    value: { getTextZoom: (): number => textZoom },
    configurable: true,
  });
};

const setThrowingAndroidTextZoom = (): void => {
  Object.defineProperty(window, 'SUPAndroid', {
    value: {
      getTextZoom: (): never => {
        throw new Error('bridge unavailable');
      },
    },
    configurable: true,
  });
};

const restoreAndroidInterface = (descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor) {
    Object.defineProperty(window, 'SUPAndroid', descriptor);
  } else {
    delete (window as Window & { SUPAndroid?: unknown }).SUPAndroid;
  }
};
