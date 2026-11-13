import { Log } from '../log';
import { _resetBootTimingsForTest, logBootTimings, markBoot } from './boot-timing';

describe('boot-timing', () => {
  let logSpy: jasmine.Spy;

  beforeEach(() => {
    _resetBootTimingsForTest();
    logSpy = spyOn(Log, 'log');
  });

  afterEach(() => _resetBootTimingsForTest());

  it('logs all marks once, in order, as ms since navigation start', () => {
    markBoot('main-start');
    markBoot('data-loaded');

    logBootTimings();
    logBootTimings();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.calls.argsFor(0)[0]).toMatch(
      /^\[Boot\] ms since navigation start: main-start=\d+ data-loaded=\d+$/,
    );
  });

  it('ignores marks after the report', () => {
    markBoot('main-start');
    logBootTimings();
    const markSpy = spyOn(performance, 'mark');

    markBoot('hydrate-start');

    expect(markSpy).not.toHaveBeenCalled();
  });
});
