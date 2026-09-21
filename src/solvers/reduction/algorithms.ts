import type { Axis, Face } from '../../core/geometry';
import { invertMove, type Move } from '../../core/moves';
import { CUBE_FRAMES, transformMove, type CubeFrame } from './frame';

export type TurnAmount = 1 | 2 | 3;

export type AlgorithmStep =
  | { readonly kind: 'move'; readonly move: Move }
  | { readonly kind: 'face'; readonly face: Face; readonly turns?: TurnAmount }
  | { readonly kind: 'slice'; readonly face: Face; readonly depth: number; readonly turns?: TurnAmount }
  | { readonly kind: 'wide'; readonly face: Face; readonly width: number; readonly turns?: TurnAmount }
  | {
    readonly kind: 'layers';
    readonly axis: Axis;
    readonly from: number;
    readonly to: number;
    readonly turns: TurnAmount;
  }
  | { readonly kind: 'conjugate'; readonly frame: CubeFrame; readonly steps: readonly AlgorithmStep[] };

const FACE_CONFIG: Readonly<Record<Face, { axis: Axis; positive: boolean; baseTurns: 1 | 3 }>> = {
  R: { axis: 0, positive: true, baseTurns: 1 },
  L: { axis: 0, positive: false, baseTurns: 3 },
  U: { axis: 1, positive: true, baseTurns: 1 },
  D: { axis: 1, positive: false, baseTurns: 3 },
  F: { axis: 2, positive: true, baseTurns: 1 },
  B: { axis: 2, positive: false, baseTurns: 3 },
};

function validateInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} ${value} must be an integer from ${min} to ${max}`);
  }
}

function relativeTurns(base: 1 | 3, turns: TurnAmount): TurnAmount {
  if (turns === 2 || base === 1) return turns;
  return (4 - turns) as 1 | 3;
}

function faceLayers(size: number, face: Face, depth: number, width: number, turns: TurnAmount): Move[] {
  validateInteger('Depth', depth, 1, size);
  validateInteger('Width', width, 1, size - depth + 1);
  const config = FACE_CONFIG[face];
  const physicalTurns = relativeTurns(config.baseTurns, turns);
  return Array.from({ length: width }, (_, offset) => {
    const faceDepth = depth + offset;
    return {
      axis: config.axis,
      layer: config.positive ? size - faceDepth : faceDepth - 1,
      turns: physicalTurns,
    };
  });
}

function compileStep(size: number, step: AlgorithmStep): Move[] {
  switch (step.kind) {
    case 'move':
      validateInteger('Layer', step.move.layer, 0, size - 1);
      return [{ ...step.move }];
    case 'face':
      return faceLayers(size, step.face, 1, 1, step.turns ?? 1);
    case 'slice':
      return faceLayers(size, step.face, step.depth, 1, step.turns ?? 1);
    case 'wide':
      return faceLayers(size, step.face, 1, step.width, step.turns ?? 1);
    case 'layers': {
      validateInteger('First layer', step.from, 0, size - 1);
      validateInteger('Last layer', step.to, 0, size - 1);
      if (step.from > step.to) throw new RangeError('Layer range must be ascending');
      return Array.from({ length: step.to - step.from + 1 }, (_, offset) => ({
        axis: step.axis,
        layer: step.from + offset,
        turns: step.turns,
      }));
    }
    case 'conjugate': {
      if (!CUBE_FRAMES.some((frame) => frame.id === step.frame.id)) {
        throw new Error('Conjugation frame is not one of the 24 proper cube orientations');
      }
      return compileAlgorithm(size, step.steps).map((move) => transformMove(step.frame, size, move));
    }
  }
}

export function compileAlgorithm(size: number, steps: readonly AlgorithmStep[]): Move[] {
  if (!Number.isInteger(size) || size < 2 || size > 9) {
    throw new RangeError('Cube size must be an integer from 2 to 9');
  }
  return steps.flatMap((step) => compileStep(size, step));
}

export function invertAlgorithm(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}
