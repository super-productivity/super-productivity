import {
  calculateProductivityScore,
  calculateSustainabilityScore,
} from '../metric-scoring.util';
import { T } from '../../../t.const';
import { getDailyStateInfo } from './get-daily-state-info.util';

describe('getDailyStateInfo', () => {
  it('classifies minimum-impact extended-focus days as impact mismatch', () => {
    for (const focusedMinutes of [241, 300, 360]) {
      const totalWorkMinutes = 510;
      const productivityScore = calculateProductivityScore(
        1,
        focusedMinutes,
        totalWorkMinutes,
      );
      const sustainabilityScore = calculateSustainabilityScore(
        focusedMinutes,
        totalWorkMinutes,
        3,
      );
      const state = getDailyStateInfo(
        {
          id: '2026-07-19',
          impactOfWork: 1,
          focusSessions: [focusedMinutes * 60_000],
          totalWorkMinutes,
          energyCheckin: 3,
        },
        productivityScore,
        sustainabilityScore,
      );

      expect(productivityScore)
        .withContext(`${focusedMinutes} focused minutes should cross the high threshold`)
        .toBeGreaterThan(50);
      expect(sustainabilityScore)
        .withContext(`${focusedMinutes} focused minutes should remain sustainable`)
        .toBeGreaterThanOrEqual(50);
      expect(state.headlineKey)
        .withContext(`${focusedMinutes} focused minutes`)
        .toBe(T.F.METRIC.EVAL_FORM.STATE_IMPACT_MISMATCH_HEADLINE);
    }
  });
});
