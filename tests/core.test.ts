import { describe, expect, it } from 'vitest';
import { generateStickers } from '../src/core/geometry';
import {
  buildMovePermutation,
  formatMove,
  invertMove,
  movedStickerIndices,
  parseNotation,
  type Move,
} from '../src/core/moves';
import { applyMove, solvedState } from '../src/core/state';

function allQuarterMoves(size: number): Move[] {
  return ([0, 1, 2] as const).flatMap((axis) =>
    Array.from({ length: size }, (_, layer) => ({ axis, layer, turns: 1 as const })),
  );
}

describe('geometry-derived move permutations', () => {
  for (let size = 2; size <= 9; size += 1) {
    it(`builds valid reversible quarter turns for ${size}×${size}`, () => {
      const solved = solvedState(size);
      for (const move of allQuarterMoves(size)) {
        const permutation = buildMovePermutation(size, move);
        expect(permutation).toHaveLength(6 * size * size);
        expect(new Set(permutation).size).toBe(permutation.length);

        let state = solved;
        for (let turn = 0; turn < 4; turn += 1) state = applyMove(state, size, move);
        expect(state).toEqual(solved);

        const restored = applyMove(applyMove(solved, size, move), size, invertMove(move));
        expect(restored).toEqual(solved);

        const outer = move.layer === 0 || move.layer === size - 1;
        const fixedCenter = outer && size % 2 === 1 ? 1 : 0;
        const expected = 4 * size + (outer ? size * size - fixedCenter : 0);
        expect(movedStickerIndices(permutation)).toHaveLength(expected);
      }
    });
  }
});

describe('notation', () => {
  it('round-trips outer and inner moves by move identity', () => {
    const size = 7;
    const source = "R U2 F' L D2 B' 2R 3U' 2B2";
    const moves = parseNotation(source, size);
    const formatted = moves.map((move) => formatMove(move, size)).join(' ');
    expect(parseNotation(formatted, size)).toEqual(moves);
  });

  it('rejects layers outside the cube', () => {
    expect(() => parseNotation('4R', 3)).toThrow(/outside/);
  });
});

describe('sticker indexing', () => {
  it('uses U, R, F, D, L, B face-major row order', () => {
    const stickers = generateStickers(3);
    expect(stickers[0]).toMatchObject({ face: 'U', row: 0, col: 0, pos: [-2, 2, -2] });
    expect(stickers[9]).toMatchObject({ face: 'R', row: 0, col: 0, pos: [2, 2, 2] });
    expect(stickers[18]).toMatchObject({ face: 'F', row: 0, col: 0, pos: [-2, 2, 2] });
  });
});
