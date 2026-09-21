import { parseNotation, type Move } from './moves';

const FACES = ['R', 'U', 'F', 'L', 'D', 'B'] as const;
const SUFFIXES = ['', '2', "'"] as const;

export function createScramble(size: number, length = 25, random = Math.random): Move[] {
  if (size >= 4) {
    const moves: Move[] = [];
    let previousKey = '';
    const layers = ([0, 1, 2] as const).flatMap((axis) =>
      Array.from({ length: size }, (_, layer) => ({ axis, layer })),
    );
    while (moves.length < length) {
      const candidates = layers.filter(({ axis, layer }) => `${axis}:${layer}` !== previousKey);
      const selected = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
      if (!selected) continue;
      const turns = (Math.min(2, Math.floor(random() * 3)) + 1) as 1 | 2 | 3;
      moves.push({ ...selected, turns });
      previousKey = `${selected.axis}:${selected.layer}`;
    }
    return moves;
  }

  const moves: Move[] = [];
  let previousFace = '';
  while (moves.length < length) {
    const candidates = FACES.filter((face) => face !== previousFace);
    const face = candidates[Math.floor(random() * candidates.length)] ?? 'R';
    const suffix = SUFFIXES[Math.floor(random() * SUFFIXES.length)] ?? '';
    const move = parseNotation(`${face}${suffix}`, size)[0];
    if (!move) continue;
    moves.push(move);
    previousFace = face;
  }
  return moves;
}
