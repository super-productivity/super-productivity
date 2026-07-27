import { ONBOARDING_PRESETS } from './onboarding-presets.const';

describe('ONBOARDING_PRESETS', () => {
  it('enables Finish Day for the Productivity Suite preset', () => {
    const productivitySuite = ONBOARDING_PRESETS.find(
      (preset) => preset.id === 'productivity-pro',
    );

    expect(productivitySuite?.features.isFinishDayEnabled).toBeTrue();
  });
});
