import {
  MATCH_ALGORITHM_VERSION,
  computeMatchScoreFromDistance,
} from './match-score.types';

describe('computeMatchScoreFromDistance (FR-291/FR-292)', () => {
  it('maps an identical vector (distance 0) to similarity 1', () => {
    const score = computeMatchScoreFromDistance(0);
    expect(score.signals.semanticSimilarity).toBe(1);
    expect(score.total).toBe(1);
  });

  it('maps an opposite vector (distance 2) to similarity 0', () => {
    const score = computeMatchScoreFromDistance(2);
    expect(score.signals.semanticSimilarity).toBe(0);
  });

  it('maps a real, observed mid-range distance to the correct midpoint', () => {
    const score = computeMatchScoreFromDistance(1);
    expect(score.signals.semanticSimilarity).toBe(0.5);
  });

  it('maps Infinity (no embedding yet) to similarity 0, not NaN or a negative number', () => {
    const score = computeMatchScoreFromDistance(Infinity);
    expect(score.signals.semanticSimilarity).toBe(0);
  });

  it('clamps a distance below 0 (should never happen, but defensively) to similarity 1', () => {
    const score = computeMatchScoreFromDistance(-0.5);
    expect(score.signals.semanticSimilarity).toBe(1);
  });

  it('stamps the current algorithm version, and every other signal stays genuinely absent (undefined), not faked with a 0', () => {
    const score = computeMatchScoreFromDistance(0.4);
    expect(score.version).toBe(MATCH_ALGORITHM_VERSION);
    expect(score.signals.goalCompatibility).toBeUndefined();
    expect(score.signals.needOfferCompatibility).toBeUndefined();
    expect(score.signals.preferenceCompatibility).toBeUndefined();
    expect(score.signals.contextualCompatibility).toBeUndefined();
    expect(score.signals.trustSignal).toBeUndefined();
    expect(score.signals.behavioralCompatibility).toBeUndefined();
  });
});
