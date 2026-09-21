import { rotateVector, type Axis, type Vec3 } from '../../core/geometry';
import type { Move } from '../../core/moves';

export interface CubeFrame {
  readonly id: string;
  readonly basis: readonly [Vec3, Vec3, Vec3];
}

const UNIT_VECTORS: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function vectorKey(vector: Vec3): string {
  return vector.join(',');
}

function frameId(basis: readonly Vec3[]): string {
  return basis.map(vectorKey).join('|');
}

function rotateFrame(frame: CubeFrame, axis: Axis): CubeFrame {
  const basis = frame.basis.map((vector) => rotateVector(vector, axis, 1)) as [Vec3, Vec3, Vec3];
  return { id: frameId(basis), basis };
}

export const IDENTITY_FRAME: CubeFrame = {
  id: frameId(UNIT_VECTORS),
  basis: UNIT_VECTORS,
};

export const CUBE_FRAMES: readonly CubeFrame[] = (() => {
  const frames = new Map<string, CubeFrame>([[IDENTITY_FRAME.id, IDENTITY_FRAME]]);
  const queue: CubeFrame[] = [IDENTITY_FRAME];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const frame = queue[cursor];
    if (!frame) continue;
    for (const axis of [0, 1, 2] as const) {
      const next = rotateFrame(frame, axis);
      if (frames.has(next.id)) continue;
      frames.set(next.id, next);
      queue.push(next);
    }
  }
  return [...frames.values()];
})();

export function transformVector(frame: CubeFrame, vector: Vec3): Vec3 {
  const x = frame.basis[0][0] * vector[0] + frame.basis[1][0] * vector[1]
    + frame.basis[2][0] * vector[2];
  const y = frame.basis[0][1] * vector[0] + frame.basis[1][1] * vector[1]
    + frame.basis[2][1] * vector[2];
  const z = frame.basis[0][2] * vector[0] + frame.basis[1][2] * vector[1]
    + frame.basis[2][2] * vector[2];
  return [x || 0, y || 0, z || 0];
}

export function inverseFrame(frame: CubeFrame): CubeFrame {
  const basis: [Vec3, Vec3, Vec3] = [
    [frame.basis[0][0], frame.basis[1][0], frame.basis[2][0]],
    [frame.basis[0][1], frame.basis[1][1], frame.basis[2][1]],
    [frame.basis[0][2], frame.basis[1][2], frame.basis[2][2]],
  ];
  const inverse = CUBE_FRAMES.find((candidate) => candidate.id === frameId(basis));
  if (!inverse) throw new Error('Inverse cube frame is not a proper orientation');
  return inverse;
}

export function composeFrames(first: CubeFrame, second: CubeFrame): CubeFrame {
  const basis = second.basis.map((vector) => transformVector(first, vector)) as [Vec3, Vec3, Vec3];
  const composed = CUBE_FRAMES.find((candidate) => candidate.id === frameId(basis));
  if (!composed) throw new Error('Composed cube frame is not a proper orientation');
  return composed;
}

export function transformMove(frame: CubeFrame, size: number, move: Move): Move {
  const axisVector = transformVector(frame, UNIT_VECTORS[move.axis]);
  const axis = axisVector.findIndex((coordinate) => coordinate !== 0) as Axis;
  const sign = axisVector[axis];
  if (axis < 0 || (sign !== 1 && sign !== -1)) throw new Error('Frame mapped an axis incorrectly');
  return {
    axis,
    layer: sign === 1 ? move.layer : size - 1 - move.layer,
    turns: sign === 1 || move.turns === 2 ? move.turns : (4 - move.turns) as 1 | 3,
  };
}
