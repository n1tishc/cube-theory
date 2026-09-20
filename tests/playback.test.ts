import { describe, expect, it } from 'vitest';
import { createScramble } from '../src/core/scramble';
import { formatMove, parseNotation } from '../src/core/moves';
import { TimelineController } from '../src/timeline/controller';

describe('scramble and playback', () => {
  it('creates reproducible 25-move scrambles without repeating a face', () => {
    let seed = 42;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const scramble = createScramble(2, 25, random);
    expect(scramble).toHaveLength(25);
    const faces = scramble.map((move) => formatMove(move, 2).replace(/[2']/g, ''));
    faces.slice(1).forEach((face, index) => expect(face).not.toBe(faces[index]));
  });

  it('stages a sequence and seeks without forking cube state', () => {
    const controller = new TimelineController(2, 1);
    controller.insertMoves(parseNotation('R U F2', 2));
    expect(controller.getSnapshot().index).toBe(0);
    expect(controller.getSnapshot().steps).toHaveLength(3);
    controller.seek(2);
    expect(controller.getSnapshot().index).toBe(2);
    expect(controller.getSnapshot().state).toEqual(controller.getSnapshot().steps[1]?.after);
    controller.seek(0);
    expect(controller.getSnapshot().index).toBe(0);
    expect(controller.getSnapshot().state).toEqual(controller.getSnapshot().steps[0]?.before);
  });
});
