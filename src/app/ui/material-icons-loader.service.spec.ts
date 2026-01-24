import { TestBed } from '@angular/core/testing';
import { MaterialIconsLoaderService } from './material-icons-loader.service';

describe('MaterialIconsLoaderService', () => {
  let service: MaterialIconsLoaderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MaterialIconsLoaderService);
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
});
