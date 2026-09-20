import { parseNotation, type Move } from './moves';

const FACES = ['R', 'U', 'F', 'L', 'D', 'B'] as const;
const SUFFIXES = ['', '2', "'"] as const;

export function createScramble(size: number, length = 25, random = Math.random): Move[] {
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
