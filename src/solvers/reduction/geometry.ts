import {
  generateStickers,
  layerIndex,
  rotateVector,
  stickerKey,
  type Axis,
  type Face,
  type Sticker,
  type Vec3,
} from '../../core/geometry';

export type ReductionPieceKind = 'corner' | 'edge' | 'center';

export interface ReductionPieceSlot {
  readonly key: string;
  readonly kind: ReductionPieceKind;
  readonly pos: Vec3;
  readonly stickerIndices: readonly number[];
  readonly faces: readonly Face[];
  readonly orbit: number;
  readonly isAnchor: boolean;
  readonly isMidge: boolean;
}

export interface ReductionOrbit {
  readonly id: number;
  readonly kind: ReductionPieceKind;
  readonly slotKeys: readonly string[];
  readonly size: number;
  readonly isAnchor: boolean;
  readonly isMidge: boolean;
}

export interface ReductionGeometry {
  readonly size: number;
  readonly slots: readonly ReductionPieceSlot[];
  readonly orbits: readonly ReductionOrbit[];
  readonly cornerOrbits: readonly ReductionOrbit[];
  readonly centerOrbits: readonly ReductionOrbit[];
  readonly wingOrbits: readonly ReductionOrbit[];
  readonly anchorOrbit?: ReductionOrbit;
  readonly midgeOrbit?: ReductionOrbit;
  readonly slotByKey: ReadonlyMap<string, ReductionPieceSlot>;
}

function positionKey(pos: Vec3): string {
  return pos.join(',');
}

function comparePositions(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function groupStickers(stickers: readonly Sticker[]): Map<string, Sticker[]> {
  const groups = new Map<string, Sticker[]>();
  for (const sticker of stickers) {
    const key = positionKey(sticker.pos);
    const group = groups.get(key);
    if (group) group.push(sticker);
    else groups.set(key, [sticker]);
  }
  return groups;
}

function kindForStickerCount(count: number): ReductionPieceKind {
  if (count === 3) return 'corner';
  if (count === 2) return 'edge';
  if (count === 1) return 'center';
  throw new Error(`Surface position has ${count} stickers`);
}

function discoverPositionOrbits(positions: readonly Vec3[]): Vec3[][] {
  const remaining = new Set(positions.map(positionKey));
  const byKey = new Map(positions.map((pos) => [positionKey(pos), pos]));
  const orbits: Vec3[][] = [];

  while (remaining.size > 0) {
    const firstKey = remaining.values().next().value as string;
    const first = byKey.get(firstKey);
    if (!first) throw new Error('Orbit seed is missing');
    const queue: Vec3[] = [first];
    const orbit: Vec3[] = [];
    remaining.delete(firstKey);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (!current) continue;
      orbit.push(current);
      for (const axis of [0, 1, 2] as const) {
        const rotated = rotateVector(current, axis, 1);
        const key = positionKey(rotated);
        if (!remaining.delete(key)) continue;
        const position = byKey.get(key);
        if (position) queue.push(position);
      }
    }

    orbit.sort(comparePositions);
    orbits.push(orbit);
  }

  return orbits.sort((a, b) => positionKey(a[0] ?? [0, 0, 0]).localeCompare(
    positionKey(b[0] ?? [0, 0, 0]),
  ));
}

function freeCoordinates(pos: Vec3, edge: number): number[] {
  return pos.filter((coordinate) => Math.abs(coordinate) !== edge);
}

export function buildReductionGeometry(size: number): ReductionGeometry {
  const stickers = generateStickers(size);
  const groups = groupStickers(stickers);
  const positions = [...groups.values()].map((group) => group[0]?.pos).filter(
    (pos): pos is Vec3 => pos !== undefined,
  );
  const positionOrbits = discoverPositionOrbits(positions);
  const orbitByPosition = new Map<string, number>();
  positionOrbits.forEach((orbit, id) => {
    orbit.forEach((pos) => orbitByPosition.set(positionKey(pos), id));
  });

  const edge = size - 1;
  const slots: ReductionPieceSlot[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    if (!first) continue;
    const kind = kindForStickerCount(group.length);
    const orbit = orbitByPosition.get(key);
    if (orbit === undefined) throw new Error(`No orbit for ${key}`);
    const free = freeCoordinates(first.pos, edge);
    const isAnchor = size % 2 === 1 && kind === 'center' && free.every((value) => value === 0);
    const isMidge = size % 2 === 1 && kind === 'edge' && free[0] === 0;
    slots.push({
      key,
      kind,
      pos: first.pos,
      stickerIndices: group.map((sticker) => sticker.index).sort((a, b) => a - b),
      faces: group.map((sticker) => sticker.face),
      orbit,
      isAnchor,
      isMidge,
    });
  }
  slots.sort((a, b) => comparePositions(a.pos, b.pos));

  const orbits: ReductionOrbit[] = positionOrbits.map((positionsInOrbit, id) => {
    const members = positionsInOrbit.map((pos) => {
      const member = slots.find((slot) => slot.key === positionKey(pos));
      if (!member) throw new Error(`No surface slot for orbit position ${positionKey(pos)}`);
      return member;
    });
    const first = members[0];
    if (!first) throw new Error('Empty piece orbit');
    if (!members.every((member) => member.kind === first.kind)) {
      throw new Error('A move orbit mixed piece kinds');
    }
    return {
      id,
      kind: first.kind,
      slotKeys: members.map((member) => member.key),
      size: members.length,
      isAnchor: members.every((member) => member.isAnchor),
      isMidge: members.every((member) => member.isMidge),
    };
  });

  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const centerOrbits = orbits.filter((orbit) => orbit.kind === 'center' && !orbit.isAnchor);
  const wingOrbits = orbits.filter((orbit) => orbit.kind === 'edge' && !orbit.isMidge);
  return {
    size,
    slots,
    orbits,
    cornerOrbits: orbits.filter((orbit) => orbit.kind === 'corner'),
    centerOrbits,
    wingOrbits,
    anchorOrbit: orbits.find((orbit) => orbit.isAnchor),
    midgeOrbit: orbits.find((orbit) => orbit.isMidge),
    slotByKey,
  };
}

export function movedPieceSlotKey(
  size: number,
  slot: ReductionPieceSlot,
  axis: Axis,
  layer: number,
  turns: 1 | 2 | 3,
): string {
  const coordinate = -(size - 1) + 2 * layer;
  return slot.pos[axis] === coordinate
    ? positionKey(rotateVector(slot.pos, axis, turns))
    : slot.key;
}

export function stickerIndexAt(size: number, pos: Vec3, normal: Vec3): number {
  const sticker = generateStickers(size).find(
    (candidate) => stickerKey(candidate.pos, candidate.normal) === stickerKey(pos, normal),
  );
  if (!sticker) throw new Error('Sticker geometry is not on the cube surface');
  return sticker.index;
}

export function coordinateLayer(size: number, coordinate: number): number {
  const layer = layerIndex(size, coordinate);
  if (!Number.isInteger(layer) || layer < 0 || layer >= size) {
    throw new RangeError(`Coordinate ${coordinate} is not a layer of a ${size}×${size} cube`);
  }
  return layer;
}
