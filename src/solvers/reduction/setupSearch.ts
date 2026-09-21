import type { Move } from '../../core/moves';

export interface SetupSearchOptions<State> {
  readonly initial: State;
  readonly key: (state: State) => string;
  readonly isGoal: (state: State) => boolean;
  readonly generators: readonly Move[];
  readonly apply: (state: State, move: Move) => State;
  readonly maxVisited?: number;
  readonly maxDepth?: number;
}

export interface SetupSearchResult {
  readonly moves: readonly Move[];
  readonly visited: number;
  readonly depth: number;
}

interface SearchNode<State> {
  readonly state: State;
  readonly parent: number;
  readonly move?: Move;
  readonly depth: number;
}

function reconstruct<State>(nodes: readonly SearchNode<State>[], index: number): Move[] {
  const moves: Move[] = [];
  let cursor = index;
  while (cursor >= 0) {
    const node = nodes[cursor];
    if (!node) break;
    if (node.move) moves.push(node.move);
    cursor = node.parent;
  }
  return moves.reverse();
}

export function findSetup<State>(options: SetupSearchOptions<State>): SetupSearchResult | null {
  const maxVisited = options.maxVisited ?? 250_000;
  const maxDepth = options.maxDepth ?? 12;
  if (!Number.isInteger(maxVisited) || maxVisited < 1) throw new RangeError('maxVisited must be positive');
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new RangeError('maxDepth cannot be negative');

  const nodes: SearchNode<State>[] = [{ state: options.initial, parent: -1, depth: 0 }];
  const visited = new Set([options.key(options.initial)]);
  for (let cursor = 0; cursor < nodes.length; cursor += 1) {
    const node = nodes[cursor];
    if (!node) continue;
    if (options.isGoal(node.state)) {
      return { moves: reconstruct(nodes, cursor), visited: visited.size, depth: node.depth };
    }
    if (node.depth >= maxDepth) continue;

    for (const move of options.generators) {
      const state = options.apply(node.state, move);
      const key = options.key(state);
      if (visited.has(key)) continue;
      if (visited.size >= maxVisited) return null;
      visited.add(key);
      nodes.push({ state, parent: cursor, move, depth: node.depth + 1 });
    }
  }
  return null;
}
