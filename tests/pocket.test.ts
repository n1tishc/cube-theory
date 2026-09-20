import { describe, expect, it } from 'vitest';
import { parseNotation } from '../src/core/moves';
import { applyMove, solvedState } from '../src/core/state';
import { createScramble } from '../src/core/scramble';
import {
  buildPocketDistanceTable,
  createPocketMoveTables,
  decodePocketCoordinate,
  encodePocketCorners,
  faceletsToCorners,
  nextPocketCoordinate,
  normalizePocketState,
  POCKET_MOVES,
  POCKET_STATES,
  POCKET_UNSEEN,
  solvePocketWithTable,
} from '../src/solvers/pocket';
import { isSolved } from '../src/core/state';

describe('pocket coordinates', () => {
  it('round-trips representative normalized coordinates', () => {
    const coordinates = [0, 1, 728, 729, 85_031, POCKET_STATES - 1];
    for (const coordinate of coordinates) {
      expect(encodePocketCorners(decodePocketCoordinate(coordinate))).toBe(coordinate);
    }
  });

  it('normalizes any face scramble by fixing the D-B-L corner', () => {
    let state = solvedState(2);
    for (const move of parseNotation("R U F2 L D' B R2 U'", 2)) state = applyMove(state, 2, move);
    const normalized = normalizePocketState(state);
    const corners = faceletsToCorners(normalized.state);
    expect(corners.permutation[6]).toBe(6);
    expect(corners.orientation[6]).toBe(0);
  });

  it('matches coordinate transitions to facelet moves', () => {
    const tables = createPocketMoveTables();
    let state = solvedState(2);
    let coordinate = 0;
    POCKET_MOVES.forEach((move, moveIndex) => {
      const moved = applyMove(state, 2, move);
      const encoded = encodePocketCorners(faceletsToCorners(moved));
      expect(nextPocketCoordinate(coordinate, moveIndex, tables)).toBe(encoded);
    });

    const sequence = [0, 4, 8, 2, 3, 7];
    for (const moveIndex of sequence) {
      const move = POCKET_MOVES[moveIndex];
      if (!move) continue;
      state = applyMove(state, 2, move);
      coordinate = nextPocketCoordinate(coordinate, moveIndex, tables);
    }
    expect(coordinate).toBe(encodePocketCorners(faceletsToCorners(state)));
  });

  it('covers the exact space and solves 1,000 seeded scrambles in at most 11 turns', () => {
    const tables = createPocketMoveTables();
    const distances = buildPocketDistanceTable(tables);
    expect(distances.includes(POCKET_UNSEEN)).toBe(false);
    let maximumDistance = 0;
    distances.forEach((distance) => { maximumDistance = Math.max(maximumDistance, distance); });
    expect(maximumDistance).toBeLessThanOrEqual(11);

    let seed = 0x2c0ffee;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 1_000; sample += 1) {
      let state = solvedState(2);
      for (const move of createScramble(2, 25, random)) state = applyMove(state, 2, move);
      const solution = solvePocketWithTable(state, distances, tables);
      expect(solution.length).toBeLessThanOrEqual(11);
      for (const move of solution) state = applyMove(state, 2, move);
      expect(isSolved(state, 2)).toBe(true);
    }
  }, 120_000);
});
