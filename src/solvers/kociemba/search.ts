import type { Move } from '../../core/moves';
import { applyMove, isSolved } from '../../core/state';
import { applyCubieEffect, KOCIEMBA_EFFECTS, KOCIEMBA_MOVES, mapMovesFromNormalizedFrame, normalizeThreeState, PHASE2_MOVE_INDICES, type CubieState } from './cubie';
import { encodeCornerPermutation, encodeFlip, encodeSlice, encodeSlicePermutation, encodeTwist, encodeUdEdgePermutation, FLIPS, PERMUTATIONS_8, SLICES, SLICE_PERMUTATIONS, TWISTS, type CoordinateTables } from './coordinates';

export interface PruningTables { twistSlice: Uint8Array; flipSlice: Uint8Array; cornerSlice: Uint8Array; edgeSlice: Uint8Array }
const UNSEEN = 0xff;

function buildPruning(aSize: number, bSize: number, moves: number, aTable: Uint16Array, bTable: Uint16Array | Uint8Array, onDepth?: (visited: number, total: number, depth: number) => void): Uint8Array {
  const total = aSize * bSize; const distance = new Uint8Array(total); distance.fill(UNSEEN); distance[0] = 0;
  let frontier = new Int32Array(total); let next = new Int32Array(total); let frontierSize = 1; frontier[0] = 0; let visited = 1; let depth = 0;
  while (frontierSize) {
    let nextSize = 0;
    for (let cursor = 0; cursor < frontierSize; cursor += 1) { const coordinate = frontier[cursor] ?? 0; const a = Math.floor(coordinate / bSize); const b = coordinate % bSize;
      for (let move = 0; move < moves; move += 1) { const na = aTable[a * moves + move] ?? 0; const nb = bTable[b * moves + move] ?? 0; const target = na * bSize + nb; if (distance[target] === UNSEEN) { distance[target] = depth + 1; next[nextSize++] = target; visited += 1; } }
    }
    depth += 1; onDepth?.(visited, total, depth); [frontier, next] = [next, frontier]; frontierSize = nextSize;
  }
  return distance;
}
export function createPruningTables(tables: CoordinateTables, onProgress?: (table: number, visited: number, total: number, depth: number) => void): PruningTables {
  const twistSlice = buildPruning(TWISTS, SLICES, 18, tables.twist, tables.slice, (v, t, d) => onProgress?.(0, v, t, d));
  const flipSlice = buildPruning(FLIPS, SLICES, 18, tables.flip, tables.slice, (v, t, d) => onProgress?.(1, v, t, d));
  const cornerSlice = buildPruning(PERMUTATIONS_8, SLICE_PERMUTATIONS, 10, tables.cornerPermutation, tables.slicePermutation, (v, t, d) => onProgress?.(2, v, t, d));
  const edgeSlice = buildPruning(PERMUTATIONS_8, SLICE_PERMUTATIONS, 10, tables.udEdgePermutation, tables.slicePermutation, (v, t, d) => onProgress?.(3, v, t, d));
  return { twistSlice, flipSlice, cornerSlice, edgeSlice };
}

function allowed(move: number, previous: number): boolean {
  if (previous < 0) return true; const face = Math.floor(move / 3); const priorFace = Math.floor(previous / 3);
  if (face === priorFace) return false;
  return Math.abs(face - priorFace) !== 3 || face > priorFace;
}
function phase2Allowed(localMove: number, previousGlobal: number): boolean { return allowed(PHASE2_MOVE_INDICES[localMove] ?? 0, previousGlobal); }

export function solveThree(state: Uint8Array, tables: CoordinateTables, pruning: PruningTables, maxDepth = 30): Move[] {
  const normalized = normalizeThreeState(state); const initial = normalized.cubie;
  const startTwist = encodeTwist(initial); const startFlip = encodeFlip(initial); const startSlice = encodeSlice(initial);
  const path1: number[] = []; const path2: number[] = [];
  const searchPhase2 = (cubie: CubieState, budget: number, previous: number): boolean => {
    const startCp = encodeCornerPermutation(cubie); const startEp = encodeUdEdgePermutation(cubie); const startSp = encodeSlicePermutation(cubie);
    const dfs = (cp: number, ep: number, sp: number, depth: number, prior: number): boolean => {
      const heuristic = Math.max(pruning.cornerSlice[cp * 24 + sp] ?? 0, pruning.edgeSlice[ep * 24 + sp] ?? 0);
      if (heuristic > depth) return false; if (depth === 0) return cp === 0 && ep === 0 && sp === 0;
      for (let local = 0; local < 10; local += 1) if (phase2Allowed(local, prior)) { const global = PHASE2_MOVE_INDICES[local] ?? 0; path2.push(global);
        if (dfs(tables.cornerPermutation[cp * 10 + local] ?? 0, tables.udEdgePermutation[ep * 10 + local] ?? 0, tables.slicePermutation[sp * 10 + local] ?? 0, depth - 1, global)) return true; path2.pop(); }
      return false;
    };
    const minimum = Math.max(pruning.cornerSlice[startCp * 24 + startSp] ?? 0, pruning.edgeSlice[startEp * 24 + startSp] ?? 0);
    for (let depth = minimum; depth <= budget; depth += 1) { path2.length = 0; if (dfs(startCp, startEp, startSp, depth, previous)) return true; }
    return false;
  };
  const dfs1 = (twist: number, flip: number, slice: number, depth: number, previous: number, phase2Budget: number): boolean => {
    const heuristic = Math.max(pruning.twistSlice[twist * SLICES + slice] ?? 0, pruning.flipSlice[flip * SLICES + slice] ?? 0);
    if (heuristic > depth) return false;
    if (depth === 0) {
      if (twist !== 0 || flip !== 0 || slice !== 0) return false;
      let cubie = initial;
      path1.forEach((move) => { cubie = applyCubieEffect(cubie, KOCIEMBA_EFFECTS[move]!); });
      return searchPhase2(cubie, phase2Budget, previous);
    }
    for (let move = 0; move < 18; move += 1) if (allowed(move, previous)) { path1.push(move);
      if (dfs1(tables.twist[twist * 18 + move] ?? 0, tables.flip[flip * 18 + move] ?? 0, tables.slice[slice * 18 + move] ?? 0, depth - 1, move, phase2Budget)) return true; path1.pop(); }
    return false;
  };
  const minPhase1 = Math.max(pruning.twistSlice[startTwist * SLICES + startSlice] ?? 0, pruning.flipSlice[startFlip * SLICES + startSlice] ?? 0);
  for (let depth1 = minPhase1; depth1 <= Math.min(12, maxDepth); depth1 += 1) {
    path1.length = 0; path2.length = 0; if (dfs1(startTwist, startFlip, startSlice, depth1, -1, maxDepth - depth1)) {
      const normalizedMoves = [...path1, ...path2].map((index) => KOCIEMBA_MOVES[index]!); const moves = mapMovesFromNormalizedFrame(normalizedMoves, normalized.matrix);
      let verified = state; moves.forEach((move) => { verified = applyMove(verified, 3, move); }); if (!isSolved(verified, 3)) throw new Error('3×3 solution failed verification'); return moves;
    }
  }
  throw new Error(`No 3×3 solution found within ${maxDepth} moves`);
}
