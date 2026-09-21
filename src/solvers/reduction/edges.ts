import { generateStickers } from '../../core/geometry';
import type { Move } from '../../core/moves';
import { applyMove, solvedState } from '../../core/state';
import { macroById } from './catalog';
import { invertAlgorithm } from './algorithms';
import { CUBE_FRAMES, transformMove } from './frame';
import { buildReductionGeometry } from './geometry';
import { centersSolved, edgeBundles, edgesPaired } from './invariants';

export interface EdgeSearchOptions {
  readonly beamWidth?: number;
  readonly maxDepth?: number;
  readonly maxVisited?: number;
}

export interface EdgePairingSolution {
  readonly moves: readonly Move[];
  readonly transactionCount: number;
  readonly visited: number;
  readonly depth: number;
}

interface EdgeAction {
  readonly id: string;
  readonly moves: readonly Move[];
  readonly sourceByDestination: Uint8Array;
}

interface SearchNode {
  readonly colors: Uint8Array;
  readonly parent: number;
  readonly action: number;
  readonly depth: number;
  readonly score: number;
}

const geometry = buildReductionGeometry(4);
const stickers = generateStickers(4);
const wingSlots = geometry.slots.filter((slot) => slot.kind === 'edge');
const wingStickerIndices = wingSlots.flatMap((slot) => slot.stickerIndices);
const wingPositionBySticker = new Map(wingStickerIndices.map((index, position) => [index, position]));
const bundlePositions = edgeBundles(geometry).map((bundle) => bundle.slots.map((slot) =>
  bundle.faces.map((face) => {
    const faceSticker = slot.stickerIndices.find((index) => stickers[index]?.face === face);
    const position = faceSticker === undefined ? undefined : wingPositionBySticker.get(faceSticker);
    if (position === undefined) throw new Error(`Missing ${face} wing sticker for ${slot.key}`);
    return position;
  }),
));

function edgeEffect(moves: readonly Move[]): Uint8Array {
  let labels: Uint8Array = Uint8Array.from({ length: 96 }, (_, index) => index);
  for (const move of moves) labels = applyMove(labels, 4, move);
  return Uint8Array.from(wingStickerIndices.map((index) => {
    const sourceSticker = labels[index];
    const source = sourceSticker === undefined ? undefined : wingPositionBySticker.get(sourceSticker);
    if (source === undefined) throw new Error('Edge transaction moved a non-wing sticker into a wing slot');
    return source;
  }));
}

function buildActions(): EdgeAction[] {
  const actions: EdgeAction[] = [];
  const seen = new Set<string>();
  const add = (id: string, moves: readonly Move[]): void => {
    const sourceByDestination = edgeEffect(moves);
    const key = sourceByDestination.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ id, moves, sourceByDestination });
  };
  for (const id of ['edge-pair-insert', 'edge-release-three-pairs']) {
    const macro = macroById(id);
    for (const frame of CUBE_FRAMES) {
      for (const [direction, source] of [['forward', macro.moves], ['inverse', macro.inverse]] as const) {
        const moves = source.map((move) => transformMove(frame, 4, move));
        add(`${id}:${frame.id}:${direction}`, moves);
      }
    }
  }
  const framedInsertions = [...actions].filter((action) => action.id.startsWith('edge-pair-insert:'));
  const outerSetups: Move[] = ([0, 1, 2] as const).flatMap((axis) => [0, 3].flatMap((layer) =>
    ([1, 2, 3] as const).map((turns) => ({ axis, layer, turns })),
  ));
  for (const insertion of framedInsertions) for (const setup of outerSetups) {
    add(
      `${insertion.id}:setup-${setup.axis}-${setup.layer}-${setup.turns}`,
      [setup, ...insertion.moves, ...invertAlgorithm([setup])],
    );
  }
  const framedReleases = [...actions].filter((action) =>
    action.id.startsWith('edge-release-three-pairs:') && !action.id.includes(':setup-'));
  for (const release of framedReleases) for (const setup of outerSetups) {
    add(
      `${release.id}:setup-${setup.axis}-${setup.layer}-${setup.turns}`,
      [setup, ...release.moves, ...invertAlgorithm([setup])],
    );
  }
  return actions;
}

export const FOUR_BY_FOUR_EDGE_ACTIONS: readonly EdgeAction[] = buildActions();

function projectWings(state: Uint8Array): Uint8Array {
  return Uint8Array.from(wingStickerIndices.map((index) => state[index] ?? 255));
}

function applyAction(colors: Uint8Array, action: EdgeAction): Uint8Array {
  return Uint8Array.from(action.sourceByDestination, (source) => colors[source] ?? 255);
}

function pairedCount(colors: Uint8Array): number {
  return bundlePositions.filter((slots) => {
    const reference = slots[0];
    return reference !== undefined && slots.every((slot) =>
      slot.every((position, face) => colors[position] === colors[reference[face] ?? -1]));
  }).length;
}

function reconstruct(nodes: readonly SearchNode[], index: number): number[] {
  const path: number[] = [];
  for (let cursor = index; cursor >= 0;) {
    const node = nodes[cursor];
    if (!node) break;
    if (node.action >= 0) path.push(node.action);
    cursor = node.parent;
  }
  return path.reverse();
}

function constructivePairing(
  initial: Uint8Array,
  maxDepth: number,
  maxVisited: number,
): { colors: Uint8Array; path: number[]; visited: number } {
  let colors = initial;
  const path: number[] = [];
  let visited = 1;
  while (path.length < maxDepth) {
    const current = pairedCount(colors);
    if (current === 12) break;
    let best: { colors: Uint8Array; action: number; paired: number } | undefined;
    for (let action = 0; action < FOUR_BY_FOUR_EDGE_ACTIONS.length; action += 1) {
      if (visited >= maxVisited) return { colors, path, visited };
      const next = applyAction(colors, FOUR_BY_FOUR_EDGE_ACTIONS[action]!);
      visited += 1;
      const paired = pairedCount(next);
      if (paired <= current || (best && paired <= best.paired)) continue;
      best = { colors: next, action, paired };
    }
    if (!best) break;
    colors = best.colors;
    path.push(best.action);
  }
  return { colors, path, visited };
}

/** Bounded search over center-preserving, physically qualified edge transactions. */
export function pairFourByFourEdges(state: Uint8Array, options: EdgeSearchOptions = {}): EdgePairingSolution {
  if (state.length !== 96) throw new Error('A 4×4 state must contain 96 facelets');
  if (!centersSolved(state, 4)) throw new Error('Edge pairing requires solved centers');
  if (edgesPaired(state, 4)) return { moves: [], transactionCount: 0, visited: 1, depth: 0 };
  const beamWidth = options.beamWidth ?? 1_000;
  const maxDepth = options.maxDepth ?? 24;
  const maxVisited = options.maxVisited ?? 250_000;
  const initial = projectWings(state);
  let constructive = constructivePairing(initial, maxDepth, maxVisited);
  if (pairedCount(constructive.colors) === 9 && constructive.path.length < maxDepth) {
    let best = constructive;
    for (let release = 0; release < FOUR_BY_FOUR_EDGE_ACTIONS.length; release += 1) {
      const action = FOUR_BY_FOUR_EDGE_ACTIONS[release]!;
      if (!action.id.startsWith('edge-release-three-pairs:')) continue;
      const remainingVisited = maxVisited - constructive.visited;
      if (remainingVisited <= 1) break;
      const released = applyAction(constructive.colors, action);
      const attempt = constructivePairing(
        released,
        maxDepth - constructive.path.length - 1,
        remainingVisited,
      );
      const candidate = {
        colors: attempt.colors,
        path: [...constructive.path, release, ...attempt.path],
        visited: constructive.visited + attempt.visited,
      };
      if (pairedCount(candidate.colors) > pairedCount(best.colors)) best = candidate;
      if (pairedCount(candidate.colors) === 12) break;
    }
    constructive = best;
  }
  const constructiveMoves = constructive.path.flatMap((selected) => [...FOUR_BY_FOUR_EDGE_ACTIONS[selected]!.moves]);
  if (pairedCount(constructive.colors) === 12) {
    const verified = constructiveMoves.reduce((current, move) => applyMove(current, 4, move), state);
    if (!centersSolved(verified, 4) || !edgesPaired(verified, 4)) {
      throw new Error('Constructive edge path failed full-state replay');
    }
    return {
      moves: constructiveMoves,
      transactionCount: constructive.path.length,
      visited: constructive.visited,
      depth: constructive.path.length,
    };
  }
  const nodes: SearchNode[] = [{
    colors: constructive.colors,
    parent: -1,
    action: -1,
    depth: 0,
    score: 12 - pairedCount(constructive.colors),
  }];
  const visited = new Set([constructive.colors.join(',')]);
  let frontier = [0];

  for (let depth = 1; depth <= maxDepth - constructive.path.length; depth += 1) {
    const candidates: number[] = [];
    for (const parent of frontier) {
      const node = nodes[parent]!;
      for (let actionIndex = 0; actionIndex < FOUR_BY_FOUR_EDGE_ACTIONS.length; actionIndex += 1) {
        const colors = applyAction(node.colors, FOUR_BY_FOUR_EDGE_ACTIONS[actionIndex]!);
        const score = 12 - pairedCount(colors);
        if (score > node.score + 1) continue;
        const key = colors.join(',');
        if (visited.has(key)) continue;
        if (constructive.visited + visited.size - 1 >= maxVisited) {
          throw new Error(
            `Edge search exceeded ${maxVisited.toLocaleString()} projected states after pairing ${pairedCount(constructive.colors)}/12 bundles with ${constructive.path.length} transactions`,
          );
        }
        visited.add(key);
        nodes.push({ colors, parent, action: actionIndex, depth, score });
        const index = nodes.length - 1;
        if (score === 0) {
          const path = reconstruct(nodes, index);
          const moves = [
            ...constructiveMoves,
            ...path.flatMap((selected) => [...FOUR_BY_FOUR_EDGE_ACTIONS[selected]!.moves]),
          ];
          const verified = moves.reduce((current, move) => applyMove(current, 4, move), state);
          if (!centersSolved(verified, 4) || !edgesPaired(verified, 4)) {
            throw new Error('Edge search path failed full-state replay');
          }
          return {
            moves,
            transactionCount: constructive.path.length + path.length,
            visited: constructive.visited + visited.size - 1,
            depth: constructive.path.length + depth,
          };
        }
        candidates.push(index);
      }
    }
    candidates.sort((left, right) => nodes[left]!.score - nodes[right]!.score || left - right);
    frontier = candidates.slice(0, beamWidth);
    if (!frontier.length) break;
  }
  throw new Error(
    `Edge search found no solution within depth ${maxDepth} after pairing ${pairedCount(constructive.colors)}/12 bundles with ${constructive.path.length} transactions`,
  );
}

export function edgeActionCount(): number { return FOUR_BY_FOUR_EDGE_ACTIONS.length; }

if (!FOUR_BY_FOUR_EDGE_ACTIONS.every((action) => {
  const result = action.moves.reduce((current, move) => applyMove(current, 4, move), solvedState(4));
  return centersSolved(result, 4);
})) throw new Error('Invalid 4×4 edge action catalog');
