import {
  getInitialBottomPanelHeightRatio,
  getMaxBottomPanelHeight,
} from './bottom-panel-container.component';

describe('getInitialBottomPanelHeightRatio', () => {
  it('uses the compact height for task panels', () => {
    expect(getInitialBottomPanelHeightRatio('TASK')).toBe(0.6);
  });

  it('uses the compact height for notes panels', () => {
    expect(getInitialBottomPanelHeightRatio('NOTES')).toBe(0.6);
  });

  it('uses the expanded height for other panels', () => {
    expect(getInitialBottomPanelHeightRatio('ISSUE_PANEL')).toBe(0.9);
    expect(getInitialBottomPanelHeightRatio(null)).toBe(0.9);
  });
});

describe('getMaxBottomPanelHeight', () => {
  it('uses the relative cap when there is no top inset', () => {
    expect(getMaxBottomPanelHeight(1000, 0)).toBe(980);
  });

  it('keeps the panel top below a notch taller than the relative margin (#10181)', () => {
    expect(getMaxBottomPanelHeight(844, 47)).toBe(797);
  });

  it('keeps the relative cap when it is already below a small inset', () => {
    expect(getMaxBottomPanelHeight(1000, 10)).toBe(980);
  });
});
