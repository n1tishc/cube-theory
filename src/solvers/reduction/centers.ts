import { FACE_ORDER } from '../../core/geometry';
import type { Move } from '../../core/moves';
import { applyMove, solvedState } from '../../core/state';
import { macroById } from './catalog';
import { CUBE_FRAMES, transformMove } from './frame';
import { buildReductionGeometry } from './geometry';
import { centersSolved } from './invariants';
import { invertAlgorithm } from './algorithms';

export interface CenterSearchOptions {
  readonly beamWidth?: number;
  readonly maxDepth?: number;
  readonly maxVisited?: number;
}

export interface CenterSolution {
  readonly moves: readonly Move[];
  readonly macroCount: number;
  readonly visited: number;
  readonly depth: number;
}

interface CenterAction {
  readonly id: string;
  readonly moves: readonly Move[];
  readonly sourceByDestination: Uint8Array;
}

interface BeamNode {
  readonly colors: Uint8Array;
  readonly parent: number;
  readonly action: number;
  readonly depth: number;
  readonly score: number;
}

interface LockedInsertionResult {
  readonly colors: Uint8Array;
  readonly actions: readonly number[];
  readonly visited: number;
  readonly locked: number;
}

const geometry = buildReductionGeometry(4);
const centerSlots = geometry.slots.filter((slot) => slot.kind === 'center');
const centerStickerIndices = centerSlots.map((slot) => slot.stickerIndices[0] ?? -1);
const centerPositionBySticker = new Map(centerStickerIndices.map((index, position) => [index, position]));
const goal = Uint8Array.from(centerSlots.map((slot) => FACE_ORDER.indexOf(slot.faces[0]!)));

function centerEffect(moves: readonly Move[]): Uint8Array {
  const labels = Uint8Array.from({ length: 96 }, (_, index) => index);
  let moved: Uint8Array = labels;
  for (const move of moves) moved = applyMove(moved, 4, move);
  return Uint8Array.from(centerStickerIndices.map((index) => {
    const sourceSticker = moved[index];
    const source = sourceSticker === undefined ? undefined : centerPositionBySticker.get(sourceSticker);
    if (source === undefined) throw new Error('Center macro moved a non-center into a center slot');
    return source;
  }));
}

function buildActions(): CenterAction[] {
  const ids = ['center-insert-front', 'center-insert-opposite', 'center-pair-cycle', 'center-pair-swap', 'center-last-pair'];
  const actions: CenterAction[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const macro = macroById(id);
    for (const frame of CUBE_FRAMES) for (const [direction, source] of [['forward', macro.moves], ['inverse', macro.inverse]] as const) {
      const moves = source.map((move) => transformMove(frame, 4, move));
      const sourceByDestination = centerEffect(moves);
      const key = sourceByDestination.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ id: `${id}:${frame.id}:${direction}`, moves, sourceByDestination });
    }
  }
  // Direct inner-slice turns provide the constructive transport graph; the
  // qualified transactions above provide short insertion and terminal edges.
  for (const axis of [0, 1, 2] as const) for (const layer of [0, 1, 2, 3]) for (const turns of [1, 2, 3] as const) {
    const moves: Move[] = [{ axis, layer, turns }];
    const sourceByDestination = centerEffect(moves);
    const key = sourceByDestination.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({ id: `layer:${axis}:${layer}:${turns}`, moves, sourceByDestination });
  }
  return actions;
}

export const FOUR_BY_FOUR_CENTER_ACTIONS: readonly CenterAction[] = buildActions();

function projectCenters(state: Uint8Array): Uint8Array {
  return Uint8Array.from(centerStickerIndices.map((index) => state[index] ?? 255));
}

function applyAction(colors: Uint8Array, action: CenterAction): Uint8Array {
  return Uint8Array.from(action.sourceByDestination, (source) => colors[source] ?? 255);
}

function misplaced(colors: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < colors.length; index += 1) if (colors[index] !== goal[index]) count += 1;
  return count;
}

function reconstruct(nodes: readonly BeamNode[], index: number): number[] {
  const actions: number[] = [];
  for (let cursor = index; cursor >= 0;) {
    const node = nodes[cursor];
    if (!node) break;
    if (node.action >= 0) actions.push(node.action);
    cursor = node.parent;
  }
  return actions.reverse();
}

function preservesLocks(colors: Uint8Array, locked: readonly number[]): boolean {
  return locked.every((index) => colors[index] === goal[index]);
}

/**
 * Build a monotonic solved prefix using the qualified macros as atomic
 * transactions. A transaction may disturb a locked slot internally, but its
 * projected effect must restore every lock before the next stage begins.
 */
function lockedInsertion(initial: Uint8Array, maxVisited: number, maxActions: number): LockedInsertionResult {
  let colors = initial;
  const actions: number[] = [];
  const locked: number[] = [];
  let visited = 1;
  const macroActions = FOUR_BY_FOUR_CENTER_ACTIONS
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => !action.id.startsWith('layer:'));

  while (locked.length < goal.length && actions.length < maxActions && visited < maxVisited) {
    let madeProgress = false;
    for (let target = 0; target < goal.length; target += 1) {
      if (locked.includes(target)) continue;
      if (colors[target] === goal[target]) {
        locked.push(target);
        madeProgress = true;
        continue;
      }

      let selected: { colors: Uint8Array; path: number[] } | undefined;
      const firstLayer: { colors: Uint8Array; path: number[] }[] = [];
      for (const { action, index } of macroActions) {
        if (visited >= maxVisited) break;
        const next = applyAction(colors, action);
        visited += 1;
        if (preservesLocks(next, locked) && next[target] === goal[target]) {
          selected = { colors: next, path: [index] };
          break;
        }
        firstLayer.push({ colors: next, path: [index] });
      }

      if (!selected) {
        search: for (const first of firstLayer) {
          for (const { action, index } of macroActions) {
            if (visited >= maxVisited) break search;
            const next = applyAction(first.colors, action);
            visited += 1;
            if (!preservesLocks(next, locked) || next[target] !== goal[target]) continue;
            selected = { colors: next, path: [...first.path, index] };
            break search;
          }
        }
      }

      if (!selected || actions.length + selected.path.length > maxActions) continue;
      colors = selected.colors;
      actions.push(...selected.path);
      locked.push(target);
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  return { colors, actions, visited, locked: locked.length };
}

interface MeetNode { readonly colors: Uint8Array; readonly moves: readonly Move[]; readonly depth: number }

function projectedKey(colors: Uint8Array): string {
  return colors.join(',');
}

function sliceMeetInMiddle(initial: Uint8Array, maxDepth: number, maxVisited: number): CenterSolution | null {
  const actions = FOUR_BY_FOUR_CENTER_ACTIONS.filter((action) => action.id.startsWith('layer:'));
  const sideDepth = Math.min(3, Math.floor(maxDepth / 2));
  let remaining = maxVisited;
  const expand = (start: Uint8Array) => {
    const found = new Map<string, MeetNode>([[projectedKey(start), { colors: start, moves: [], depth: 0 }]]);
    remaining -= 1;
    let frontier = [...found.values()];
    let exhausted = false;
    for (let depth = 1; depth <= sideDepth; depth += 1) {
      const next: MeetNode[] = [];
      for (const node of frontier) {
        for (const action of actions) {
          const colors = applyAction(node.colors, action);
          const key = projectedKey(colors);
          if (found.has(key)) continue;
          if (remaining <= 0) {
            exhausted = true;
            break;
          }
          const candidate = { colors, moves: [...node.moves, ...action.moves], depth };
          found.set(key, candidate);
          remaining -= 1;
          next.push(candidate);
        }
        if (exhausted) break;
      }
      frontier = next;
      if (exhausted) break;
    }
    return found;
  };
  const fromGoal = expand(goal);
  const fromInitial = expand(initial);
  for (const [key, startNode] of fromInitial) {
    const goalNode = fromGoal.get(key);
    if (!goalNode) continue;
    const moves = [...startNode.moves, ...invertAlgorithm(goalNode.moves)];
    return {
      moves,
      macroCount: startNode.depth + goalNode.depth,
      visited: maxVisited - remaining,
      depth: startNode.depth + goalNode.depth,
    };
  }
  return null;
}

/** Bounded deterministic search over center colors only; physical macros are replayed afterward. */
export function solveFourByFourCenters(state: Uint8Array, options: CenterSearchOptions = {}): CenterSolution {
  if (state.length !== 96) throw new Error('A 4×4 state must contain 96 facelets');
  if (centersSolved(state, 4)) return { moves: [], macroCount: 0, visited: 1, depth: 0 };
  const beamWidth = options.beamWidth ?? 4_000;
  const maxDepth = options.maxDepth ?? 48;
  const maxVisited = options.maxVisited ?? 250_000;
  const initial = projectCenters(state);
  const direct = sliceMeetInMiddle(initial, maxDepth, maxVisited);
  if (direct) {
    const verified = direct.moves.reduce((current, move) => applyMove(current, 4, move), state);
    if (centersSolved(verified, 4)) return direct;
  }
  const insertion = maxDepth > 8 || misplaced(initial) >= 16
    ? lockedInsertion(initial, maxVisited, maxDepth)
    : { colors: initial, actions: [], visited: 0, locked: 0 };
  const insertionMoves = insertion.actions.flatMap((selected) => [...FOUR_BY_FOUR_CENTER_ACTIONS[selected]!.moves]);
  if (misplaced(insertion.colors) === 0) {
    const verified = insertionMoves.reduce((current, move) => applyMove(current, 4, move), state);
    if (!centersSolved(verified, 4)) throw new Error('Locked center insertion failed full-state replay');
    return {
      moves: insertionMoves,
      macroCount: insertion.actions.length,
      visited: insertion.visited,
      depth: insertion.actions.length,
    };
  }
  const nodes: BeamNode[] = [{ colors: insertion.colors, parent: -1, action: -1, depth: 0, score: misplaced(insertion.colors) }];
  let frontier = [0];
  const visited = new Set([projectedKey(insertion.colors)]);

  const remainingDepth = maxDepth - insertion.actions.length;
  for (let depth = 1; depth <= remainingDepth; depth += 1) {
    const candidates: number[] = [];
    for (const parent of frontier) {
      const node = nodes[parent]!;
      for (let actionIndex = 0; actionIndex < FOUR_BY_FOUR_CENTER_ACTIONS.length; actionIndex += 1) {
        const action = FOUR_BY_FOUR_CENTER_ACTIONS[actionIndex]!;
        const colors = applyAction(node.colors, action);
        const score = misplaced(colors);
        // Center insertions occasionally need a small detour, but allowing
        // unbounded regressions floods the frontier with irrelevant macros.
        if (score > node.score + 2) continue;
        const key = projectedKey(colors);
        if (visited.has(key)) continue;
        if (visited.size >= maxVisited) {
          throw new Error(
            `Center search exceeded ${maxVisited.toLocaleString()} projected states after locking ${insertion.locked}/24 centers`,
          );
        }
        visited.add(key);
        nodes.push({ colors, parent, action: actionIndex, depth, score });
        const index = nodes.length - 1;
        if (score === 0) {
          const actionPath = reconstruct(nodes, index);
          const moves = [
            ...insertionMoves,
            ...actionPath.flatMap((selected) => [...FOUR_BY_FOUR_CENTER_ACTIONS[selected]!.moves]),
          ];
          const verified = moves.reduce((current, move) => applyMove(current, 4, move), state);
          if (!centersSolved(verified, 4)) throw new Error('Center search path failed full-state replay');
          return {
            moves,
            macroCount: insertion.actions.length + actionPath.length,
            visited: insertion.visited + visited.size,
            depth: insertion.actions.length + depth,
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
    `Center search found no solution within depth ${maxDepth} after locking ${insertion.locked}/24 centers with ${insertion.actions.length} macros`,
  );
}

export function centerActionCount(): number { return FOUR_BY_FOUR_CENTER_ACTIONS.length; }

// Assert the static action compiler itself leaves the solved color inventory valid.
if (!FOUR_BY_FOUR_CENTER_ACTIONS.every((action) => {
  const state = action.moves.reduce((current, move) => applyMove(current, 4, move), solvedState(4));
  return state.length === 96;
})) throw new Error('Invalid 4×4 center action catalog');
