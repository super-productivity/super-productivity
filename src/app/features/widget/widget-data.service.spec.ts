import {
  getWidgetValidUntilMs,
  serializeWidgetData,
  WidgetPushQueue,
} from './widget-data.service';

describe('getWidgetValidUntilMs', () => {
  const hours = (value: number): number => value * 60 * 60 * 1000;

  it('expires at the next local midnight with the default day boundary', () => {
    const now = new Date(2026, 6, 13, 15, 30).getTime();

    expect(getWidgetValidUntilMs(now, 0)).toBe(new Date(2026, 6, 14, 0, 0).getTime());
  });

  it('keeps the previous logical day valid until a configured 03:00 boundary', () => {
    const now = new Date(2026, 6, 13, 1, 0).getTime();

    expect(getWidgetValidUntilMs(now, hours(3))).toBe(
      new Date(2026, 6, 13, 3, 0).getTime(),
    );
  });

  it('moves the configured boundary to the following day once it has passed', () => {
    const now = new Date(2026, 6, 13, 4, 0).getTime();

    expect(getWidgetValidUntilMs(now, hours(3))).toBe(
      new Date(2026, 6, 14, 3, 0).getTime(),
    );
  });

  it('expires exactly when the app fixed-offset logical date changes across DST', () => {
    const offsetMs = hours(3);
    const validUntil = getWidgetValidUntilMs(
      new Date(2026, 2, 28, 12, 0).getTime(),
      offsetMs,
    );
    const logicalDateBefore = new Date(validUntil - 1 - offsetMs).getDate();
    const logicalDateAtBoundary = new Date(validUntil - offsetMs).getDate();

    expect(logicalDateAtBoundary).not.toBe(logicalDateBefore);
  });
});

describe('serializeWidgetData', () => {
  it('includes the logical-day expiry in the native snapshot', async () => {
    const now = new Date(2026, 6, 13, 15, 30).getTime();
    expect(
      serializeWidgetData(
        {
          v: 1 as const,
          tasks: [],
          projectColors: {},
        },
        now,
        0,
      ),
    ).toBe(
      JSON.stringify({
        v: 1,
        tasks: [],
        projectColors: {},
        validUntil: new Date(2026, 6, 14, 0, 0).getTime(),
      }),
    );
  });
});

describe('WidgetPushQueue', () => {
  it('runs native snapshot writes sequentially', async () => {
    const queue = new WidgetPushQueue();
    const order: string[] = [];
    let releaseFirst!: (value: boolean) => void;
    const firstGate = new Promise<boolean>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('first-start');
      return firstGate;
    });
    const second = queue.enqueue(async () => {
      order.push('second-start');
      return true;
    });
    await Promise.resolve();

    expect(order).toEqual(['first-start']);
    releaseFirst(true);
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'second-start']);
  });

  it('continues after a failed write', async () => {
    const queue = new WidgetPushQueue();
    const second = jasmine.createSpy('second').and.resolveTo(true);

    await expectAsync(
      queue.enqueue(async () => {
        throw new Error('failed');
      }),
    ).toBeRejectedWithError('failed');
    await expectAsync(queue.enqueue(second)).toBeResolvedTo(true);

    expect(second).toHaveBeenCalledTimes(1);
  });
});
