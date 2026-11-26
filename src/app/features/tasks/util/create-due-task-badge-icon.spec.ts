import { createDueTaskBadgeIcon } from './create-due-task-badge-icon';

describe('createDueTaskBadgeIcon', () => {
  it('renders a transparent, neutral badge with centered white digits for small and large counts', async () => {
    for (const count of [5, 6, 10, 99, 100]) {
      const url = createDueTaskBadgeIcon(count)!;
      const image = new Image();
      image.src = url;
      await image.decode();
      expect(image.width).toBe(64);
      expect(image.height).toBe(64);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixelAt = (x: number, y: number): number[] =>
        Array.from(context.getImageData(x, y, 1, 1).data);
      expect(pixelAt(0, 0)).withContext(`corner, count ${count}`).toEqual([0, 0, 0, 0]);
      // Probe the circle above and below the count: the digits are centered on
      // y = 32 and never taller than the largest font size (44px), so rows
      // 5 and 58 are circle only whatever font the platform falls back to.
      // A probe beside the count is not: a wide fallback (Inter on Linux)
      // draws "99+" across x = 7..57.
      for (const y of [5, 58]) {
        expect(pixelAt(32, y))
          .withContext(`circle at y=${y}, count ${count}`)
          .toEqual([55, 55, 55, 255]);
      }
      const pixels = context.getImageData(0, 0, 64, 64).data;
      const whitePoints: { x: number; y: number }[] = [];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] > 245 && pixels[offset + 3] > 245) {
          const pixel = offset / 4;
          whitePoints.push({ x: pixel % 64, y: Math.floor(pixel / 64) });
        }
      }
      expect(whitePoints.length).withContext(`count ${count}`).toBeGreaterThan(0);
      const ys = whitePoints.map((point) => point.y);
      const center = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(Math.abs(center - 32))
        .withContext(`count ${count}`)
        .toBeLessThan(2);
    }
    expect(createDueTaskBadgeIcon(100)).toBe(createDueTaskBadgeIcon(1000));
    expect(createDueTaskBadgeIcon(5)).not.toBe(createDueTaskBadgeIcon(6));
  });
});
