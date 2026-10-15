import { describe, expect, it } from 'vitest';
import type { Stage } from '../types/stage';
import { areaAt, areaStage, areaTimeline, dynamicParTime, syncParTime, writeArea } from './areas';
import { createObject, createStage } from './stageIO';

const dyn = (): Stage =>
  syncParTime({
    ...createStage(),
    areaTime: 3,
    transition: { duration: 2, direction: 'ltr', style: 'mesh' },
    areas: [
      { id: 'a2', environment: 'outdoor_01', objects: [createObject('paper_full', 0.3, 0.6)], time: 4 },
      { id: 'a3', environment: 'indoor_02', objects: [], time: 5 },
    ],
  });

describe('dynamic stage areas', () => {
  it('derives the par time from areas and transitions', () => {
    expect(dynamicParTime(dyn())).toBe(3 + 2 + 4 + 2 + 5);
    expect(dyn().parTime).toBe(16);
  });

  it('builds the timeline', () => {
    expect(areaTimeline(dyn()).map((p) => [p.kind, p.start, p.end])).toEqual([
      ['area', 0, 3],
      ['transition', 3, 5],
      ['area', 5, 9],
      ['transition', 9, 11],
      ['area', 11, 16],
    ]);
  });

  it('swaps at the middle of the transition, area clocks start after the barrier', () => {
    const s = dyn();
    const parts = areaTimeline(s);
    expect(areaAt(s, parts, 1, true)).toEqual({ area: 0, areaStart: 0, transition: null });
    const pair = { from: 0, fromStart: 0, to: 1, toStart: 5 };
    expect(areaAt(s, parts, 3.5, true)).toEqual({ area: 0, areaStart: 0, transition: 0.25, pair });
    expect(areaAt(s, parts, 4.5, true)).toEqual({ area: 1, areaStart: 5, transition: 0.75, pair });
    expect(areaAt(s, parts, 10, true).pair).toEqual({ from: 1, fromStart: 5, to: 2, toStart: 11 });
    expect(areaAt(s, parts, 6, true)).toEqual({ area: 1, areaStart: 5, transition: null });
    expect(areaAt(s, parts, 15, true).area).toBe(2);
    // after the end beep ("TIME") the last area stays
    expect(areaAt(s, parts, 16.5, true).area).toBe(2);
    // standby / reset: start position
    expect(areaAt(s, parts, 6, false).area).toBe(0);
  });

  it('edits an area as a plain stage and writes it back', () => {
    const s = dyn();
    const a = areaStage(s, 1);
    expect(a.environment).toBe('outdoor_01');
    const edited = { ...a, name: 'Renamed', objects: [...a.objects, createObject('steel_popper', 0.5, 0.6)] };
    const back = writeArea(s, 1, edited);
    expect(back.name).toBe('Renamed');
    expect(back.objects).toEqual(s.objects); // area 1 untouched
    expect(back.environment).toBe(s.environment);
    expect(back.areas![0].objects).toHaveLength(2);
    expect(back.areas![1]).toEqual(s.areas![1]);
  });

  it('leaves classic stages unchanged', () => {
    const s = createStage();
    expect(areaStage(s, 0)).toBe(s);
    expect(areaTimeline(s)).toEqual([{ kind: 'area', area: 0, start: 0, end: s.parTime }]);
    expect(areaAt(s, areaTimeline(s), 2, true)).toEqual({ area: 0, areaStart: 0, transition: null });
  });
});
