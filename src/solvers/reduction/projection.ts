import {
  FACE_DEFINITIONS,
  generateStickers,
  stickerKey,
  type Sticker,
  type Vec3,
} from '../../core/geometry';
import type { Move } from '../../core/moves';
import { applyPermutation } from '../../core/state';
import { diagnoseThreeFacelets, type CubieDiagnostics } from '../kociemba/cubie';
import { CUBE_FRAMES, IDENTITY_FRAME, inverseFrame, transformMove, transformVector, type CubeFrame } from './frame';

export interface ReducedProjection {
  readonly state: Uint8Array;
  readonly diagnostics: CubieDiagnostics;
  readonly frame: CubeFrame;
}

export interface ReducedThreeSolution {
  readonly projection: ReducedProjection;
  readonly virtualMoves: readonly Move[];
  readonly moves: readonly Move[];
}

function validateState(state: Uint8Array, size: number): void {
  if (!Number.isInteger(size) || size < 4 || size > 9) {
    throw new RangeError('Reduced projection supports cube sizes from 4 to 9');
  }
  if (state.length !== 6 * size * size) {
    throw new Error(`A ${size}×${size} state must contain ${6 * size * size} facelets`);
  }
  const counts = new Array<number>(6).fill(0);
  state.forEach((color) => {
    if (color < 6) counts[color] = (counts[color] ?? 0) + 1;
  });
  if (counts.some((count) => count !== size * size)) {
    throw new Error(`Invalid ${size}×${size} color counts`);
  }
}

export function reframeState(state: Uint8Array, size: number, frame: CubeFrame): Uint8Array {
  if (!CUBE_FRAMES.some((candidate) => candidate.id === frame.id)) {
    throw new Error('State frame is not one of the 24 proper cube orientations');
  }
  const stickers = generateStickers(size);
  if (state.length !== stickers.length) throw new Error('State and cube size differ');
  const byGeometry = new Map(stickers.map((sticker) => [stickerKey(sticker.pos, sticker.normal), sticker.index]));
  const permutation = new Uint16Array(stickers.length);
  for (const sticker of stickers) {
    const destination = byGeometry.get(stickerKey(
      transformVector(frame, sticker.pos),
      transformVector(frame, sticker.normal),
    ));
    if (destination === undefined) throw new Error('Frame produced unknown sticker geometry');
    permutation[destination] = sticker.index;
  }
  return applyPermutation(state, permutation);
}

function faceForNormal(normal: Vec3): number {
  const face = FACE_DEFINITIONS.findIndex((definition) =>
    definition.normal.every((coordinate, axis) => coordinate === normal[axis]),
  );
  if (face < 0) throw new Error(`Unknown face normal ${normal.join(',')}`);
  return face;
}

function isBoundary(value: number, edge: number): boolean {
  return Math.abs(value) === edge;
}

function matchingCorner(stickers: readonly Sticker[], virtual: Sticker, edge: number): Sticker[] {
  const position: Vec3 = virtual.pos.map((coordinate) => Math.sign(coordinate) * edge) as unknown as Vec3;
  return stickers.filter((sticker) => stickerKey(sticker.pos, sticker.normal) === stickerKey(position, virtual.normal));
}

function matchingEdgeFacelets(stickers: readonly Sticker[], virtual: Sticker, edge: number): Sticker[] {
  return stickers.filter((sticker) => sticker.normal.every(
    (coordinate, axis) => coordinate === virtual.normal[axis],
  ) && sticker.pos.every((coordinate, axis) => {
    const virtualCoordinate = virtual.pos[axis] ?? 0;
    return virtualCoordinate === 0
      ? !isBoundary(coordinate, edge)
      : coordinate === Math.sign(virtualCoordinate) * edge;
  }));
}

function matchingCenters(stickers: readonly Sticker[], virtual: Sticker, edge: number): Sticker[] {
  return stickers.filter((sticker) => sticker.normal.every(
    (coordinate, axis) => coordinate === virtual.normal[axis],
  ) && sticker.pos.every((coordinate, axis) => {
    const normal = virtual.normal[axis] ?? 0;
    return normal === 0 ? !isBoundary(coordinate, edge) : coordinate === normal * edge;
  }));
}

function oneColor(state: Uint8Array, candidates: readonly Sticker[], error: string): number {
  const first = candidates[0];
  const color = first ? state[first.index] : undefined;
  if (color === undefined || candidates.some((sticker) => state[sticker.index] !== color)) {
    throw new Error(error);
  }
  return color;
}

export function projectReducedState(
  input: Uint8Array,
  size: number,
  frame: CubeFrame = IDENTITY_FRAME,
): ReducedProjection {
  validateState(input, size);
  const state = frame === IDENTITY_FRAME ? input : reframeState(input, size, frame);
  const stickers = generateStickers(size);
  const edge = size - 1;
  const projected = new Uint8Array(54);

  for (const virtual of generateStickers(3)) {
    const boundaryCount = virtual.pos.filter((coordinate) => Math.abs(coordinate) === 2).length;
    if (boundaryCount === 3) {
      const candidates = matchingCorner(stickers, virtual, edge);
      if (candidates.length !== 1) throw new Error('Reduced projection has missing corner geometry');
      projected[virtual.index] = state[candidates[0]?.index ?? 0] ?? 0;
    } else if (boundaryCount === 2) {
      projected[virtual.index] = oneColor(
        state,
        matchingEdgeFacelets(stickers, virtual, edge),
        'Reduced projection requires every edge bundle to be complete and consistently oriented',
      );
    } else {
      const color = oneColor(
        state,
        matchingCenters(stickers, virtual, edge),
        'Reduced projection requires every center block to be monochromatic',
      );
      if (color !== faceForNormal(virtual.normal)) {
        throw new Error('Reduced projection center colors are not in the selected legal frame');
      }
      projected[virtual.index] = color;
    }
  }

  return { state: projected, diagnostics: diagnoseThreeFacelets(projected), frame };
}

export function liftThreeMove(move: Move, size: number): Move {
  if (!Number.isInteger(size) || size < 4 || size > 9) {
    throw new RangeError('3×3 moves can be lifted only to sizes from 4 to 9');
  }
  if (move.layer !== 0 && move.layer !== 2) {
    throw new Error('A reduced 3×3 solution must contain outer-layer moves only');
  }
  return { ...move, layer: move.layer === 0 ? 0 : size - 1 };
}

export function liftThreeMoves(
  moves: readonly Move[],
  size: number,
  projectionFrame: CubeFrame = IDENTITY_FRAME,
): Move[] {
  const workingToInput = inverseFrame(projectionFrame);
  return moves.map((move) => transformMove(workingToInput, size, liftThreeMove(move, size)));
}

export function solveReducedWithThree(
  input: Uint8Array,
  size: number,
  solve: (state: Uint8Array) => readonly Move[],
  frame: CubeFrame = IDENTITY_FRAME,
): ReducedThreeSolution {
  const projection = projectReducedState(input, size, frame);
  if (projection.diagnostics.flipParity || projection.diagnostics.permutationParity) {
    throw new Error(
      `Reduced state requires parity repair (flip=${projection.diagnostics.flipParity}, permutation=${projection.diagnostics.permutationParity})`,
    );
  }
  const virtualMoves = [...solve(projection.state)];
  return {
    projection,
    virtualMoves,
    moves: liftThreeMoves(virtualMoves, size, frame),
  };
}
