import { describe, expect, it } from 'vitest';
import { generateStickers, stickerKey, type Vec3 } from '../src/core/geometry';
import { applyMove, solvedState } from '../src/core/state';
import {
  diagnoseThreeFacelets,
  faceletsToCubie,
  KOCIEMBA_MOVES,
} from '../src/solvers/kociemba/cubie';
import { macroById } from '../src/solvers/reduction/catalog';
import { CUBE_FRAMES, IDENTITY_FRAME, inverseFrame } from '../src/solvers/reduction/frame';
import { buildReductionGeometry } from '../src/solvers/reduction/geometry';
import {
  liftThreeMove,
  liftThreeMoves,
  projectReducedState,
  reframeState,
  solveReducedWithThree,
} from '../src/solvers/reduction/projection';

function stickerIndex(pos: Vec3, normal: Vec3): number {
  const sticker = generateStickers(3).find(
    (candidate) => stickerKey(candidate.pos, candidate.normal) === stickerKey(pos, normal),
  );
  if (!sticker) throw new Error('Test sticker is missing');
  return sticker.index;
}

function swap(state: Uint8Array, first: number, second: number): Uint8Array {
  const copy = state.slice();
  [copy[first], copy[second]] = [copy[second] ?? 0, copy[first] ?? 0];
  return copy;
}

describe('structural 3×3 diagnostics', () => {
  const ur = [
    stickerIndex([2, 2, 0], [0, 1, 0]),
    stickerIndex([2, 2, 0], [1, 0, 0]),
  ] as const;
  const ul = [
    stickerIndex([-2, 2, 0], [0, 1, 0]),
    stickerIndex([-2, 2, 0], [-1, 0, 0]),
  ] as const;

  it('reports edge-flip and permutation parity independently', () => {
    const solved = solvedState(3);
    const flipped = swap(solved, ur[0], ur[1]);
    expect(diagnoseThreeFacelets(flipped)).toMatchObject({
      flipParity: 1,
      permutationParity: 0,
    });

    let exchanged = swap(solved, ur[0], ul[0]);
    exchanged = swap(exchanged, ur[1], ul[1]);
    expect(diagnoseThreeFacelets(exchanged)).toMatchObject({
      flipParity: 0,
      permutationParity: 1,
    });

    let both = swap(flipped, ur[0], ul[0]);
    both = swap(both, ur[1], ul[1]);
    expect(diagnoseThreeFacelets(both)).toMatchObject({
      flipParity: 1,
      permutationParity: 1,
    });
  });

  it('keeps the existing strict decoder strict', () => {
    expect(() => faceletsToCubie(swap(solvedState(3), ur[0], ur[1]))).toThrow(/edge flip/);
    let exchanged = swap(solvedState(3), ur[0], ul[0]);
    exchanged = swap(exchanged, ur[1], ul[1]);
    expect(() => faceletsToCubie(exchanged)).toThrow(/permutation parity/);
  });

  it('rejects a mirrored corner order and nonzero corner-twist sum', () => {
    const corner = [
      stickerIndex([2, 2, 2], [0, 1, 0]),
      stickerIndex([2, 2, 2], [1, 0, 0]),
      stickerIndex([2, 2, 2], [0, 0, 1]),
    ] as const;
    expect(() => diagnoseThreeFacelets(swap(solvedState(3), corner[1], corner[2])))
      .toThrow(/mirrored/);

    const twisted = solvedState(3);
    const copy = twisted.slice();
    copy[corner[0]] = twisted[corner[2]] ?? 0;
    copy[corner[1]] = twisted[corner[0]] ?? 0;
    copy[corner[2]] = twisted[corner[1]] ?? 0;
    expect(() => diagnoseThreeFacelets(copy)).toThrow(/corner twist/);
  });
});

describe('NxN reduced projection and move lifting', () => {
  for (let size = 4; size <= 9; size += 1) {
    it(`projects solved and outer-scrambled ${size}×${size} states`, () => {
      let nxn = solvedState(size);
      let virtual = solvedState(3);
      for (const move of KOCIEMBA_MOVES.slice(0, 9)) {
        nxn = applyMove(nxn, size, liftThreeMove(move, size));
        virtual = applyMove(virtual, 3, move);
      }
      const projection = projectReducedState(nxn, size);
      expect(projection.state).toEqual(virtual);
      expect(projection.diagnostics).toEqual(diagnoseThreeFacelets(virtual));
    });

    it(`commutes with all 18 outer moves on ${size}×${size}`, () => {
      let state = solvedState(size);
      for (const move of KOCIEMBA_MOVES.slice(3, 12)) {
        state = applyMove(state, size, liftThreeMove(move, size));
      }
      const projected = projectReducedState(state, size).state;
      for (const move of KOCIEMBA_MOVES) {
        const nxnAfter = applyMove(state, size, liftThreeMove(move, size));
        const projectedAfter = projectReducedState(nxnAfter, size).state;
        expect(projectedAfter).toEqual(applyMove(projected, 3, move));
      }
    });
  }

  it('normalizes every proper frame and maps lifted moves back exactly once', () => {
    const size = 6;
    let working = solvedState(size);
    let virtual = solvedState(3);
    for (const move of KOCIEMBA_MOVES.slice(2, 11)) {
      working = applyMove(working, size, liftThreeMove(move, size));
      virtual = applyMove(virtual, 3, move);
    }

    for (const frame of CUBE_FRAMES) {
      const input = reframeState(working, size, inverseFrame(frame));
      expect(projectReducedState(input, size, frame).state).toEqual(virtual);
      for (const move of KOCIEMBA_MOVES) {
        const lifted = liftThreeMoves([move], size, frame)[0];
        expect(lifted).toBeDefined();
        const after = applyMove(input, size, lifted as typeof move);
        expect(projectReducedState(after, size, frame).state).toEqual(applyMove(virtual, 3, move));
      }
    }
  });

  it('rejects middle-layer 3×3 output and invalid target sizes', () => {
    expect(() => liftThreeMove({ axis: 0, layer: 1, turns: 1 }, 4)).toThrow(/outer-layer/);
    expect(() => liftThreeMove({ axis: 0, layer: 2, turns: 1 }, 3)).toThrow(/4 to 9/);
    expect(liftThreeMoves([], 4, IDENTITY_FRAME)).toEqual([]);
  });

  it('adapts a legal virtual solution and rejects unrepaired parity', () => {
    const size = 4;
    const scramble = KOCIEMBA_MOVES.slice(1, 7);
    let state = solvedState(size);
    for (const move of scramble) state = applyMove(state, size, liftThreeMove(move, size));
    const inverse = [...scramble].reverse().map((move) => ({
      ...move,
      turns: (move.turns === 2 ? 2 : 4 - move.turns) as 1 | 2 | 3,
    }));
    const result = solveReducedWithThree(state, size, () => inverse);
    for (const move of result.moves) state = applyMove(state, size, move);
    expect(state).toEqual(solvedState(size));
    expect(result.virtualMoves).toEqual(inverse);

    let parity = solvedState(size);
    for (const move of macroById('parity-single-bundle-flip').moves) {
      parity = applyMove(parity, size, move);
    }
    expect(() => solveReducedWithThree(parity, size, () => [])).toThrow(/parity repair/);
  });

  it('rejects incomplete bundles, center blocks, and malformed arrays', () => {
    const size = 4;
    const geometry = buildReductionGeometry(size);
    const edgeSlots = geometry.slots.filter((slot) => slot.kind === 'edge');
    const firstEdgeSticker = edgeSlots[0]?.stickerIndices[0];
    const differentEdgeSticker = edgeSlots.flatMap((slot) => slot.stickerIndices).find((index) =>
      solvedState(size)[index] !== solvedState(size)[firstEdgeSticker ?? 0]
    );
    expect(firstEdgeSticker).toBeDefined();
    expect(differentEdgeSticker).toBeDefined();
    expect(() => projectReducedState(
      swap(solvedState(size), firstEdgeSticker ?? 0, differentEdgeSticker ?? 0),
      size,
    )).toThrow(/edge bundle/);

    const centerSlots = geometry.slots.filter((slot) => slot.kind === 'center');
    const firstCenter = centerSlots[0]?.stickerIndices[0];
    const differentCenter = centerSlots.find((slot) =>
      solvedState(size)[slot.stickerIndices[0] ?? 0] !== solvedState(size)[firstCenter ?? 0],
    )?.stickerIndices[0];
    expect(() => projectReducedState(
      swap(solvedState(size), firstCenter ?? 0, differentCenter ?? 0),
      size,
    )).toThrow(/center block/);
    expect(() => projectReducedState(new Uint8Array(10), size)).toThrow(/must contain/);
  });

  it('classifies the qualified 4×4 parity macro outputs', () => {
    const expected = {
      'parity-single-bundle-flip': { flipParity: 1, permutationParity: 0 },
      'parity-bundle-permutation': { flipParity: 0, permutationParity: 1 },
    } as const;
    for (const [id, parity] of Object.entries(expected)) {
      let state = solvedState(4);
      for (const move of macroById(id).moves) state = applyMove(state, 4, move);
      expect(projectReducedState(state, 4).diagnostics, id).toMatchObject(parity);
    }
  });
});
