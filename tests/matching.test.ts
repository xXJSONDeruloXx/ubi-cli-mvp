import { describe, expect, it } from 'vitest';
import {
  isLikelyNumericId,
  normalizeForMatch,
  scoreTitleMatch
} from '../src/util/matching';

describe('matching helpers', () => {
  it('normalizes punctuation and casing for title matching', () => {
    expect(normalizeForMatch("Assassin's Creed® Unity")).toBe(
      'assassin s creed unity'
    );
  });

  it('scores exact matches above partial matches', () => {
    expect(scoreTitleMatch('unity', "Assassin's Creed Unity")).toBeGreaterThan(
      0
    );
    expect(
      scoreTitleMatch("Assassin's Creed Unity", "Assassin's Creed Unity")
    ).toBe(100);
  });

  it('detects numeric product ids', () => {
    expect(isLikelyNumericId('46')).toBe(true);
    expect(isLikelyNumericId('ac-unity')).toBe(false);
  });
});
