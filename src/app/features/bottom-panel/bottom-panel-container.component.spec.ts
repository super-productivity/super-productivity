import { getInitialBottomPanelHeightRatio } from './bottom-panel-container.component';

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
