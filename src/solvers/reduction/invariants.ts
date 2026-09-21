import { FACE_ORDER, generateStickers, type Face } from '../../core/geometry';
import type { ReductionGeometry, ReductionPieceSlot } from './geometry';
import { buildReductionGeometry } from './geometry';

export interface EdgeBundle {
  readonly key: string;
  readonly faces: readonly [Face, Face];
  readonly slots: readonly ReductionPieceSlot[];
}

function sortedFaces(slot: ReductionPieceSlot): [Face, Face] {
  const faces = [...slot.faces].sort(
    (a, b) => FACE_ORDER.indexOf(a) - FACE_ORDER.indexOf(b),
  );
  const first = faces[0];
  const second = faces[1];
  if (!first || !second) throw new Error(`Edge slot ${slot.key} does not have two faces`);
  return [first, second];
}

export function edgeBundles(geometry: ReductionGeometry): EdgeBundle[] {
  const grouped = new Map<string, ReductionPieceSlot[]>();
  for (const slot of geometry.slots.filter((candidate) => candidate.kind === 'edge')) {
    const key = sortedFaces(slot).join('');
    const group = grouped.get(key);
    if (group) group.push(slot);
    else grouped.set(key, [slot]);
  }
  return [...grouped.entries()].map(([key, slots]) => ({
    key,
    faces: sortedFaces(slots[0] as ReductionPieceSlot),
    slots: slots.sort((a, b) => a.key.localeCompare(b.key)),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

function colorOnFace(state: Uint8Array, size: number, slot: ReductionPieceSlot, face: Face): number {
  const stickers = generateStickers(size);
  const index = slot.stickerIndices.find((stickerIndex) => stickers[stickerIndex]?.face === face);
  const color = index === undefined ? undefined : state[index];
  if (color === undefined) throw new Error(`Edge slot ${slot.key} has no ${face} sticker`);
  return color;
}

export function centersSolved(state: Uint8Array, size: number): boolean {
  if (state.length !== 6 * size * size) return false;
  const geometry = buildReductionGeometry(size);
  return geometry.slots
    .filter((slot) => slot.kind === 'center')
    .every((slot) => {
      const stickerIndex = slot.stickerIndices[0];
      const face = slot.faces[0];
      return stickerIndex !== undefined && face !== undefined
        && state[stickerIndex] === FACE_ORDER.indexOf(face);
    });
}

export function pairedEdgeBundleCount(state: Uint8Array, size: number): number {
  if (state.length !== 6 * size * size) return 0;
  return edgeBundles(buildReductionGeometry(size)).filter((bundle) => {
    const reference = bundle.slots[0];
    if (!reference) return false;
    const expected = bundle.faces.map((face) => colorOnFace(state, size, reference, face));
    return bundle.slots.every((slot) => bundle.faces.every(
      (face, index) => colorOnFace(state, size, slot, face) === expected[index],
    ));
  }).length;
}

export function edgesPaired(state: Uint8Array, size: number): boolean {
  return pairedEdgeBundleCount(state, size) === 12;
}
