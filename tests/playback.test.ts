import { describe, expect, it } from 'vitest';
import { createScramble } from '../src/core/scramble';
import { formatMove, parseNotation } from '../src/core/moves';
import { MAX_TIMELINE_MOVES, prepareTimelineSteps, TimelineController } from '../src/timeline/controller';

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

  it('yields while preparing a synthetic long solution and commits it atomically', async () => {
    const controller = new TimelineController(3, 1);
    const initial = controller.getSnapshot().state.slice();
    const moves = Array.from({ length: 1_001 }, (_, index) => parseNotation(index % 2 ? 'R' : "R'", 3)[0]!);
    let yields = 0;
    const steps = await prepareTimelineSteps(initial, 3, moves, async () => { yields += 1; }, 100);
    expect(yields).toBe(10);
    expect(controller.getSnapshot().steps).toHaveLength(0);
    expect(controller.insertPreparedSteps(steps, initial)).toBe(true);
    expect(controller.getSnapshot().steps).toHaveLength(1_001);
  });

  it('rejects paths beyond the timeline resource bound', async () => {
    const move = parseNotation('R', 3)[0]!;
    await expect(prepareTimelineSteps(new Uint8Array(54), 3, Array(MAX_TIMELINE_MOVES + 1).fill(move))).rejects.toThrow(/resource limit/);
  });
});
