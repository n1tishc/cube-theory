import { describe, expect, it } from 'vitest';
import { parseQaSolveDelay } from '../src/solvers/qaDelay';

describe('solver QA delay', () => {
  it('is disabled outside development fixtures', () => {
    expect(parseQaSolveDelay('?qaSolveDelayMs=1500', false)).toBe(0);
  });

  it('accepts a bounded positive development delay', () => {
    expect(parseQaSolveDelay('?qaSolveDelayMs=1500', true)).toBe(1500);
    expect(parseQaSolveDelay('?qaSolveDelayMs=99999', true)).toBe(5000);
  });

  it('rejects missing, nonnumeric, and nonpositive delays', () => {
    expect(parseQaSolveDelay('', true)).toBe(0);
    expect(parseQaSolveDelay('?qaSolveDelayMs=nope', true)).toBe(0);
    expect(parseQaSolveDelay('?qaSolveDelayMs=-1', true)).toBe(0);
  });
});
