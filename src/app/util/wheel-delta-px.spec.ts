import { wheelDeltaPx } from './wheel-delta-px';

describe('wheelDeltaPx', () => {
  it('passes pixel deltas through', () => {
    expect(wheelDeltaPx(40, WheelEvent.DOM_DELTA_PIXEL, 300)).toBe(40);
  });

  it('scales line deltas to a fixed line height', () => {
    expect(wheelDeltaPx(3, WheelEvent.DOM_DELTA_LINE, 300)).toBe(48);
    expect(wheelDeltaPx(-3, WheelEvent.DOM_DELTA_LINE, 300)).toBe(-48);
  });

  it('scales page deltas by the page size', () => {
    expect(wheelDeltaPx(1, WheelEvent.DOM_DELTA_PAGE, 300)).toBe(300);
  });
});
