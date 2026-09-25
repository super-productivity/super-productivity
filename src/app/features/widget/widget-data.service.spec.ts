import { WidgetPushQueue } from './widget-data.service';

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
