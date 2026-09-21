import type { Face } from '../../core/geometry';
import { buildMovePermutation, invertMove, type Move } from '../../core/moves';
import { composePermutations } from '../../core/state';
import { compileAlgorithm, type AlgorithmStep, type TurnAmount } from './algorithms';
import { buildReductionGeometry, movedPieceSlotKey } from './geometry';

export type MacroCategory = 'center' | 'edge-pairing' | 'edge-terminal' | 'parity';

export interface MacroSource {
  readonly title: string;
  readonly url: string;
  readonly section: string;
  readonly notation: 'jaap-single-inner-slice';
}

export interface PieceCycle {
  readonly kind: 'corner' | 'edge' | 'center';
  readonly slots: readonly string[];
}

export interface QualifiedMacro {
  readonly id: string;
  readonly category: MacroCategory;
  readonly size: 4;
  readonly source: MacroSource;
  readonly sourceAlgorithm: string;
  readonly setup: string;
  readonly desiredEffect: string;
  readonly preservedInvariants: readonly string[];
  readonly moves: readonly Move[];
  readonly inverse: readonly Move[];
  readonly permutation: Uint16Array;
  readonly pieceCycles: readonly PieceCycle[];
}

const SOURCE: MacroSource = {
  title: "Jaap's Puzzle Page: Rubik's Revenge",
  url: 'https://www.jaapsch.net/puzzles/cube4.htm',
  section: 'Solution 3: Pairing up edges',
  notation: 'jaap-single-inner-slice',
};

interface MacroDefinition {
  readonly id: string;
  readonly category: MacroCategory;
  readonly section?: string;
  readonly algorithm: string;
  readonly setup: string;
  readonly desiredEffect: string;
  readonly preservedInvariants: readonly string[];
}

const DEFINITIONS: readonly MacroDefinition[] = [
  {
    id: 'center-insert-front',
    category: 'center',
    section: 'Solution 3, Phase 1, step 3',
    algorithm: "r U r'",
    setup: 'Target U center is staged at the F/dr center slot; destination is U/bl.',
    desiredEffect: 'Insert the staged center into U/bl while restoring the r slice.',
    preservedInvariants: ['Previously locked center slots outside U and the active r slice'],
  },
  {
    id: 'center-insert-opposite',
    category: 'center',
    section: 'Solution 3, Phase 1, step 3',
    algorithm: 'r2 U r2',
    setup: 'Target U center is staged at the D/br center slot; destination is U/bl.',
    desiredEffect: 'Insert an opposite-face center into U/bl while restoring slice alignment.',
    preservedInvariants: ['Previously locked center slots outside U, D, and the active r slice'],
  },
  {
    id: 'center-pair-cycle',
    category: 'center',
    section: 'Solution 2, Phase 4, step 1',
    algorithm: "r2 u r2 u'",
    setup: 'Three target centers occupy the canonical Fur, Rub, Bur/Lub cycle slots.',
    desiredEffect: 'Cycle centers between opposite face-pairs without mixing the other face-pair sets.',
    preservedInvariants: ['Corners', 'Centers outside the two active inner slices'],
  },
  {
    id: 'center-pair-swap',
    category: 'center',
    section: 'Solution 2, Phase 4, step 1',
    algorithm: "r f' r' F r f r' F'",
    setup: 'The two centers to exchange are staged at canonical Fur and Rdf slots.',
    desiredEffect: 'Exchange the staged F/R centers while restoring outer-face setup turns.',
    preservedInvariants: ['Corners', 'Center face-pair membership outside F/R'],
  },
  {
    id: 'center-last-pair',
    category: 'center',
    section: 'Solution 2, Phase 4, step 2',
    algorithm: 'u2 r2 u2 r2',
    setup: 'Only the canonical F/B center pair remains, arranged in the documented two-face case.',
    desiredEffect: 'Resolve the terminal two-face center arrangement.',
    preservedInvariants: ['Corners', 'Centers on the four locked faces'],
  },
  {
    id: 'edge-pair-insert',
    category: 'edge-pairing',
    algorithm: "r U' R U r' U' R' U",
    setup: 'Matching wings are staged at FDr and FUl with a disposable wing at FRd.',
    desiredEffect: 'Join the staged matching wings and restore the working slice.',
    preservedInvariants: ['Solved centers', 'Previously paired bundles outside the working buffer'],
  },
  {
    id: 'edge-release-three-pairs',
    category: 'edge-terminal',
    algorithm: 'U2 r U2 r U2 r U2 r U2 r U2',
    setup: 'All remaining unmatched wings require the canonical FUr/FDr transposition.',
    desiredEffect: 'Open exactly three working pairs so normal pair insertion can finish.',
    preservedInvariants: ['Solved centers'],
  },
  {
    id: 'parity-single-bundle-flip',
    category: 'parity',
    section: 'Solution 3, Phase 3, sequence 1',
    algorithm: "r2 R2 B2 L' D2 l' D2 r D2 r' D2 F2 r' F2 l L B2 R2 r2",
    setup: 'Centers are solved and all edge bundles are complete; the parity bundle is at DF.',
    desiredEffect: 'Toggle virtual edge-flip parity by reversing the DF bundle.',
    preservedInvariants: ['Solved centers', 'Complete edge bundles'],
  },
  {
    id: 'parity-bundle-permutation',
    category: 'parity',
    section: 'Solution 3, Phase 3, sequence 2a',
    algorithm: 'd2 r2 D2 d2 r2 D2 r2',
    setup: 'Centers are solved and all edge bundles are complete; target bundles occupy DF/DB.',
    desiredEffect: 'Toggle virtual edge-permutation parity by exchanging two bundle pairs.',
    preservedInvariants: ['Solved centers', 'Complete edge bundles'],
  },
];

function tokenSteps(input: string): AlgorithmStep[] {
  const compact = input.replace(/\s+/g, '');
  const tokens = compact.match(/[URFDLBurfdlb](?:2|')?/g) ?? [];
  if (tokens.join('') !== compact) throw new Error(`Unsupported source algorithm: ${input}`);
  return tokens.map((token) => {
    const letter = token[0];
    if (!letter) throw new Error('Empty source move');
    const face = letter.toUpperCase() as Face;
    const suffix = token.slice(1);
    const turns: TurnAmount = suffix === '2' ? 2 : suffix === "'" ? 3 : 1;
    return letter === letter.toLowerCase()
      ? { kind: 'slice', face, depth: 2, turns }
      : { kind: 'face', face, turns };
  });
}

export function compileSourceAlgorithm(input: string): Move[] {
  return compileAlgorithm(4, tokenSteps(input));
}

export function compileMovePermutation(size: number, moves: readonly Move[]): Uint16Array {
  let permutation: Uint16Array = Uint16Array.from(
    { length: 6 * size * size },
    (_, index) => index,
  );
  for (const move of moves) {
    permutation = composePermutations(permutation, buildMovePermutation(size, move));
  }
  return permutation;
}

function pieceCyclesForMoves(size: number, moves: readonly Move[]): PieceCycle[] {
  const geometry = buildReductionGeometry(size);
  const destinationBySource = new Map<string, string>();
  for (const slot of geometry.slots) {
    const destination = moves.reduce(
      (key, move) => {
        const current = geometry.slotByKey.get(key);
        if (!current) throw new Error(`Macro moved a piece to unknown slot ${key}`);
        return movedPieceSlotKey(size, current, move.axis, move.layer, move.turns);
      },
      slot.key,
    );
    destinationBySource.set(slot.key, destination);
  }

  const visited = new Set<string>();
  const cycles: PieceCycle[] = [];
  for (const slot of geometry.slots) {
    if (visited.has(slot.key)) continue;
    const cycle: string[] = [];
    let current = slot.key;
    while (!visited.has(current)) {
      visited.add(current);
      cycle.push(current);
      current = destinationBySource.get(current) ?? current;
    }
    if (cycle.length > 1) cycles.push({ kind: slot.kind, slots: cycle });
  }
  return cycles;
}

function buildMacro(definition: MacroDefinition): QualifiedMacro {
  const moves = compileSourceAlgorithm(definition.algorithm);
  return {
    id: definition.id,
    category: definition.category,
    size: 4,
    source: { ...SOURCE, section: definition.section ?? SOURCE.section },
    sourceAlgorithm: definition.algorithm,
    setup: definition.setup,
    desiredEffect: definition.desiredEffect,
    preservedInvariants: definition.preservedInvariants,
    moves,
    inverse: [...moves].reverse().map(invertMove),
    permutation: compileMovePermutation(4, moves),
    pieceCycles: pieceCyclesForMoves(4, moves),
  };
}

export const FOUR_BY_FOUR_MACROS: readonly QualifiedMacro[] = DEFINITIONS.map(buildMacro);

export function macroById(id: string): QualifiedMacro {
  const macro = FOUR_BY_FOUR_MACROS.find((candidate) => candidate.id === id);
  if (!macro) throw new Error(`Unknown 4×4 macro: ${id}`);
  return macro;
}
