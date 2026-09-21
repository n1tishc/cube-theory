import { describe, expect, it } from 'vitest';
import { generateStickers, rotateVector, type Axis, type Vec3 } from '../src/core/geometry';
import { buildMovePermutation, type Move } from '../src/core/moves';
import { createScramble } from '../src/core/scramble';
import { applyMove, applyPermutation, solvedState } from '../src/core/state';
import { compileAlgorithm, invertAlgorithm } from '../src/solvers/reduction/algorithms';
import {
  CUBE_FRAMES,
  IDENTITY_FRAME,
  composeFrames,
  inverseFrame,
  transformMove,
  transformVector,
} from '../src/solvers/reduction/frame';
import { buildReductionGeometry, movedPieceSlotKey } from '../src/solvers/reduction/geometry';

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function labeledState(size: number): Uint8Array {
  return Uint8Array.from({ length: 6 * size * size }, (_, index) => index);
}

function applyMoves(state: Uint8Array, size: number, moves: readonly Move[]): Uint8Array {
  return moves.reduce((current, move) => applyMove(current, size, move), state);
}

describe('reduction piece geometry', () => {
  for (let size = 4; size <= 9; size += 1) {
    it(`derives the expected ${size}×${size} orbit inventory from legal rotations`, () => {
      const geometry = buildReductionGeometry(size);
      expect(geometry.cornerOrbits).toHaveLength(1);
      expect(geometry.cornerOrbits[0]?.size).toBe(8);
      expect(geometry.centerOrbits).toHaveLength(Math.floor((size - 2) ** 2 / 4));
      expect(geometry.centerOrbits.every((orbit) => orbit.size === 24)).toBe(true);
      expect(geometry.wingOrbits).toHaveLength(Math.floor((size - 2) / 2));
      expect(geometry.wingOrbits.every((orbit) => orbit.size === 24)).toBe(true);
      expect(geometry.anchorOrbit?.size).toBe(size % 2 === 1 ? 6 : undefined);
      expect(geometry.midgeOrbit?.size).toBe(size % 2 === 1 ? 12 : undefined);

      const stickerCount = geometry.slots.reduce((sum, slot) => sum + slot.stickerIndices.length, 0);
      expect(stickerCount).toBe(6 * size * size);
    });

    it(`agrees with facelet permutations for every ${size}×${size} layer move`, () => {
      const geometry = buildReductionGeometry(size);
      const stickers = generateStickers(size);
      for (const axis of [0, 1, 2] as const) {
        for (let layer = 0; layer < size; layer += 1) {
          for (const turns of [1, 2, 3] as const) {
            const move: Move = { axis, layer, turns };
            const permutation = buildMovePermutation(size, move);
            for (const slot of geometry.slots) {
              const destination = geometry.slotByKey.get(
                movedPieceSlotKey(size, slot, axis, layer, turns),
              );
              expect(destination).toBeDefined();
              const expectedSources = new Set(slot.stickerIndices);
              const actualSources = destination?.stickerIndices.map((index) => permutation[index]);
              expect(new Set(actualSources)).toEqual(expectedSources);
            }
            expect(applyPermutation(labeledState(size), permutation)).toEqual(
              applyMove(labeledState(size), size, move),
            );
          }
          expect(stickers).toHaveLength(6 * size * size);
        }
      }
    });
  }
});

describe('cube frames', () => {
  it('enumerates exactly the 24 proper cube orientations with working inverses', () => {
    expect(CUBE_FRAMES).toHaveLength(24);
    expect(new Set(CUBE_FRAMES.map((frame) => frame.id)).size).toBe(24);
    for (const frame of CUBE_FRAMES) {
      expect(composeFrames(frame, inverseFrame(frame))).toEqual(IDENTITY_FRAME);
      const images = ([0, 1, 2] as Axis[]).map((axis) => transformVector(frame, [
        axis === 0 ? 1 : 0,
        axis === 1 ? 1 : 0,
        axis === 2 ? 1 : 0,
      ]));
      expect(new Set(images.map((image) => image.join(','))).size).toBe(3);
    }
  });

  it('conjugates every layer move consistently with sticker geometry', () => {
    const size = 5;
    const stickers = generateStickers(size);
    const byGeometry = new Map(stickers.map((sticker) => [
      `${sticker.pos.join(',')}|${sticker.normal.join(',')}`,
      sticker.index,
    ]));
    for (const frame of CUBE_FRAMES) {
      const framePermutation = new Uint16Array(stickers.length);
      for (const sticker of stickers) {
        const pos = transformVector(frame, sticker.pos);
        const normal = transformVector(frame, sticker.normal);
        const destination = byGeometry.get(`${pos.join(',')}|${normal.join(',')}`);
        expect(destination).toBeDefined();
        framePermutation[destination ?? 0] = sticker.index;
      }
      for (const axis of [0, 1, 2] as const) {
        for (let layer = 0; layer < size; layer += 1) {
          const move: Move = { axis, layer, turns: 1 };
          const transformed = transformMove(frame, size, move);
          const originalThenFrame = applyPermutation(
            applyMove(labeledState(size), size, move),
            framePermutation,
          );
          const frameThenTransformed = applyMove(
            applyPermutation(labeledState(size), framePermutation),
            size,
            transformed,
          );
          expect(frameThenTransformed).toEqual(originalThenFrame);
        }
      }
    }
  });

  it('transforms coordinates as a linear proper rotation', () => {
    const vector: Vec3 = [2, -4, 0];
    for (const frame of CUBE_FRAMES) {
      expect(transformVector(inverseFrame(frame), transformVector(frame, vector))).toEqual(vector);
      expect(transformVector(frame, rotateVector(vector, 0, 1)).map((value) => value || 0)).toEqual(
        rotateVector(transformVector(frame, vector), transformMove(frame, 7, {
          axis: 0,
          layer: 4,
          turns: 1,
        }).axis, transformMove(frame, 7, { axis: 0, layer: 4, turns: 1 }).turns)
          .map((value) => value || 0),
      );
    }
  });
});

describe('typed reduction algorithm compiler', () => {
  it('keeps slice and wide turns distinct and expands ranges deterministically', () => {
    expect(compileAlgorithm(6, [
      { kind: 'slice', face: 'R', depth: 2 },
      { kind: 'wide', face: 'R', width: 2 },
      { kind: 'layers', axis: 1, from: 1, to: 3, turns: 2 },
    ])).toEqual([
      { axis: 0, layer: 4, turns: 1 },
      { axis: 0, layer: 5, turns: 1 },
      { axis: 0, layer: 4, turns: 1 },
      { axis: 1, layer: 1, turns: 2 },
      { axis: 1, layer: 2, turns: 2 },
      { axis: 1, layer: 3, turns: 2 },
    ]);
  });

  it('compiles frame conjugates and inverts sequence order and turns', () => {
    const frame = CUBE_FRAMES[7] ?? IDENTITY_FRAME;
    const source = compileAlgorithm(5, [
      { kind: 'face', face: 'U' },
      { kind: 'slice', face: 'L', depth: 2, turns: 3 },
      { kind: 'wide', face: 'F', width: 3, turns: 2 },
    ]);
    expect(compileAlgorithm(5, [{ kind: 'conjugate', frame, steps: [
      { kind: 'face', face: 'U' },
      { kind: 'slice', face: 'L', depth: 2, turns: 3 },
      { kind: 'wide', face: 'F', width: 3, turns: 2 },
    ] }])).toEqual(source.map((move) => transformMove(frame, 5, move)));

    const scrambled = applyMoves(solvedState(5), 5, source);
    expect(applyMoves(scrambled, 5, invertAlgorithm(source))).toEqual(solvedState(5));
  });

  it('rejects invalid depths, widths, ranges, and cube sizes', () => {
    expect(() => compileAlgorithm(4, [{ kind: 'slice', face: 'R', depth: 5 }])).toThrow(/Depth/);
    expect(() => compileAlgorithm(4, [{ kind: 'wide', face: 'R', width: 0 }])).toThrow(/Width/);
    expect(() => compileAlgorithm(4, [
      { kind: 'layers', axis: 0, from: 3, to: 1, turns: 1 },
    ])).toThrow(/ascending/);
    expect(() => compileAlgorithm(10, [])).toThrow(/2 to 9/);
  });
});

describe('NxN scramble fixtures', () => {
  it('retains outer-face scrambling for 2×2 and 3×3', () => {
    for (const size of [2, 3]) {
      const moves = createScramble(size, 30, sequenceRandom([0.02, 0.4, 0.8, 0.2]));
      expect(moves.every((move) => move.layer === 0 || move.layer === size - 1)).toBe(true);
    }
  });

  it('uses every inner depth in deterministic 4×4 through 9×9 fixtures', () => {
    for (let size = 4; size <= 9; size += 1) {
      const moves = createScramble(size, 100, seededRandom(0xc0be + size));
      expect(new Set(moves.map((move) => move.layer))).toEqual(
        new Set(Array.from({ length: size }, (_, layer) => layer)),
      );
      for (let index = 1; index < moves.length; index += 1) {
        expect(`${moves[index]?.axis}:${moves[index]?.layer}`).not.toBe(
          `${moves[index - 1]?.axis}:${moves[index - 1]?.layer}`,
        );
      }
    }
  });
});
