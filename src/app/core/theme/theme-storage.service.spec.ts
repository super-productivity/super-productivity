import { TestBed } from '@angular/core/testing';
import { ThemeStorageService } from './theme-storage.service';
import { LS } from '../persistence/storage-keys.const';
import { MAX_THEME_CSS_SIZE } from './validate-theme-css.util';

const makeFile = (name: string, contents: string): File =>
  new File([contents], name, { type: 'text/css' });

describe('ThemeStorageService', () => {
  let service: ThemeStorageService;

  beforeEach(async () => {
    localStorage.removeItem(LS.CUSTOM_THEME);
    TestBed.configureTestingModule({ providers: [ThemeStorageService] });
    service = TestBed.inject(ThemeStorageService);
    // Wipe any leftover entries from prior runs in the same Karma session.
    const all = await service.listThemes();
    for (const t of all) {
      await service.removeTheme(t.id);
    }
    localStorage.removeItem(LS.CUSTOM_THEME);
  });

  afterEach(() => {
    localStorage.removeItem(LS.CUSTOM_THEME);
  });

  it('installs a CSS file and exposes it via the themes signal', async () => {
    const file = makeFile('Dracula.css', ':root { --bg: #282a36; }');
    const stored = await service.installFromFile(file);
    expect(stored.id).toBe('dracula');
    expect(stored.name).toBe('Dracula');
    expect(stored.css).toContain('--bg: #282a36');

    expect(service.themes().length).toBe(1);
    expect(service.themes()[0].id).toBe('dracula');
  });

  it('round-trips install / list / get', async () => {
    await service.installFromFile(makeFile('Solar.css', ':root {}'));
    await service.installFromFile(makeFile('lunar.css', 'body {}'));

    const all = await service.listThemes();
    expect(all.map((t) => t.id).sort()).toEqual(['lunar', 'solar']);

    const fetched = await service.getTheme('solar');
    expect(fetched?.css).toBe(':root {}');
  });

  it('replaces an existing theme when re-uploading the same slug', async () => {
    await service.installFromFile(makeFile('My Theme.css', ':root { --a: 1; }'));
    await service.installFromFile(makeFile('my-theme.css', ':root { --a: 2; }'));

    const all = await service.listThemes();
    expect(all.length).toBe(1);
    expect(all[0].css).toContain('--a: 2');
  });

  it('rejects CSS containing remote url() with the validator error', async () => {
    const file = makeFile('evil.css', 'a { background: url(http://example.com/x.png); }');
    await expectAsync(service.installFromFile(file)).toBeRejectedWithError(/remote/);
    expect(service.themes().length).toBe(0);
  });

  it('rejects CSS exceeding the size cap', async () => {
    const big = 'a {} '.repeat(500 * 1024);
    const file = makeFile('big.css', big);
    await expectAsync(service.installFromFile(file)).toBeRejectedWithError(/too large/);
  });

  it('rejects oversize files before reading bytes (file.size guard)', async () => {
    // A small placeholder body (so the test stays fast) with a forged
    // `file.size` over the cap — proves the size guard short-circuits
    // before `file.text()` is called.
    const file = makeFile('big.css', 'a {}');
    Object.defineProperty(file, 'size', { value: MAX_THEME_CSS_SIZE + 1 });
    spyOn(file, 'text').and.callThrough();
    await expectAsync(service.installFromFile(file)).toBeRejectedWithError(/too large/);
    expect(file.text).not.toHaveBeenCalled();
  });

  it('removeTheme deletes the theme from IDB and signal', async () => {
    await service.installFromFile(makeFile('Solar.css', ':root {}'));
    await service.removeTheme('solar');
    expect(service.themes().length).toBe(0);
    expect(await service.getTheme('solar')).toBeUndefined();
  });

  it('removeTheme does not touch LS.CUSTOM_THEME (orchestration is CustomThemeService"s job)', async () => {
    await service.installFromFile(makeFile('Solar.css', ':root {}'));
    localStorage.setItem(LS.CUSTOM_THEME, 'user:solar');

    await service.removeTheme('solar');

    // Storage layer no longer writes LS — the active-theme handoff is
    // done by CustomThemeService.removeUserTheme(). LS stays put here.
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('user:solar');
  });

  it('slugifies filenames with spaces and special characters', async () => {
    const stored = await service.installFromFile(
      makeFile('My Awesome Theme!.css', ':root {}'),
    );
    expect(stored.id).toBe('my-awesome-theme');
    expect(stored.name).toBe('My Awesome Theme');
  });

  it('round-trips contract warnings through the IDB record', async () => {
    // CSS that's valid (no remote URLs) but missing required tokens — the
    // validator should attach warnings and the storage layer should preserve
    // them across the IDB round-trip.
    const file = makeFile('spartan.css', ':root { --bg: #111; }');
    const stored = await service.installFromFile(file);
    expect(stored.warnings).toBeDefined();
    expect(stored.warnings?.some((w) => w.token === '--surface-1')).toBe(true);

    const fetched = await service.getTheme(stored.id);
    expect(fetched?.warnings).toBeDefined();
    expect(fetched?.warnings?.length).toBe(stored.warnings?.length);
  });
});
