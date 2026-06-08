import {
  getInitialBottomPanelHeightRatio,
  isBottomPanelCloseButtonVisible,
  stopBottomPanelHeaderEventPropagation,
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

describe('isBottomPanelCloseButtonVisible', () => {
  it('only shows the close button for notes panels', () => {
    expect(isBottomPanelCloseButtonVisible('NOTES')).toBeTrue();
    expect(isBottomPanelCloseButtonVisible('TASK')).toBeFalse();
    expect(isBottomPanelCloseButtonVisible('ISSUE_PANEL')).toBeFalse();
    expect(isBottomPanelCloseButtonVisible(null)).toBeFalse();
  });
});

describe('stopBottomPanelHeaderEventPropagation', () => {
  it('stops close-button pointer and click events from starting a header drag', () => {
    const event = jasmine.createSpyObj<Event>('event', ['stopPropagation']);

    stopBottomPanelHeaderEventPropagation(event);

    expect(event.stopPropagation).toHaveBeenCalledOnceWith();
  });
});
