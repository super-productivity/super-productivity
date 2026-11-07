import { getBottomPanelSheetConfig } from './bottom-panel-sheet-config';

describe('getBottomPanelSheetConfig', () => {
  it('restores focus to the opener when opened via keyboard', () => {
    expect(getBottomPanelSheetConfig('keyboard').restoreFocus).toBe(true);
  });

  it('does not restore focus when opened via touch', () => {
    expect(getBottomPanelSheetConfig('touch').restoreFocus).toBe(false);
  });

  it('does not restore focus when opened via mouse', () => {
    expect(getBottomPanelSheetConfig('mouse').restoreFocus).toBe(false);
  });

  it('does not restore focus when the opening input is unknown', () => {
    expect(getBottomPanelSheetConfig(null).restoreFocus).toBe(false);
  });

  it('keeps autoFocus off so the tag input does not open its autocomplete', () => {
    expect(getBottomPanelSheetConfig('touch').autoFocus).toBe(false);
  });
});
