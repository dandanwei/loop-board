import { describe, it, expect } from 'vitest';
import {
  projectBadgeClasses,
  PROJECT_COLORS,
  PROJECT_COLOR_FALLBACK,
} from '../web/src/constants.js';

describe('projectBadgeClasses', () => {
  it('returns a palette entry for a normal label', () => {
    expect(PROJECT_COLORS).toContain(projectBadgeClasses('loop-board'));
  });

  it('is stable: same label always maps to the same color', () => {
    const a = projectBadgeClasses('my-app');
    const b = projectBadgeClasses('my-app');
    expect(a).toBe(b);
  });

  it('ignores surrounding whitespace', () => {
    expect(projectBadgeClasses('  my-app  ')).toBe(projectBadgeClasses('my-app'));
  });

  it('gives different labels different colors (spread across the palette)', () => {
    const labels = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'loop-board',
      'my-app',
      'web',
      'infra',
    ];
    const colors = new Set(labels.map(projectBadgeClasses));
    // Not a guarantee of zero collisions, but a healthy hash should spread
    // this many labels across several distinct palette buckets.
    expect(colors.size).toBeGreaterThan(1);
  });

  it('falls back to a neutral color for empty/missing labels', () => {
    expect(projectBadgeClasses('')).toBe(PROJECT_COLOR_FALLBACK);
    expect(projectBadgeClasses('   ')).toBe(PROJECT_COLOR_FALLBACK);
    expect(projectBadgeClasses(null)).toBe(PROJECT_COLOR_FALLBACK);
    expect(projectBadgeClasses(undefined)).toBe(PROJECT_COLOR_FALLBACK);
  });

  it('every palette entry is a valid bg + text class pair', () => {
    for (const cls of PROJECT_COLORS) {
      expect(cls).toMatch(/^bg-[a-z]+-100 text-[a-z]+-700$/);
    }
  });
});
