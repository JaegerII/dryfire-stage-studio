import { describe as group, expect, it } from 'vitest';
import { crossingWindow, describe, leadCm, sounderOrder } from './rules';
import type { Crossing } from './types';

const crossing = (over: Partial<Crossing>): Crossing => ({ id: 'c', at: 10, animals: ['ueberlaeufer'], gait: 'trot', speed: 3.6, distance: 35, direction: 'ltr', seed: 1, ...over });

group('driven hunt crossings', () => {
  it('orders a sounder lead first, then young, then yearlings', () => {
    expect(sounderOrder(['ueberlaeufer', 'frischling', 'bache'])).toEqual(['bache', 'frischling', 'ueberlaeufer']);
  });

  it('estimates lead and timing', () => {
    expect(leadCm(crossing({ speed: 8, distance: 50 }))).toBe(50);
    const w = crossingWindow(crossing({ at: 10 }));
    expect(w.enter).toBeGreaterThan(10);
    expect(w.leave).toBeGreaterThan(w.enter + 5);
    expect(describe(['bache', 'frischling', 'frischling'])).toBe('Rotte · 1 Bache, 2 Frischlinge');
  });
});

group('hunt program', () => {
  it('plays briefing, a title card and the drive per scenario, then the summary', async () => {
    const { huntProgram, huntFrameAt, INTRO_SECONDS, TITLE_SECONDS } = await import('./program');
    const { createScenario } = await import('./repository');
    const a = createScenario('buche_herbst', 0);
    const b = createScenario('buche_winter', 2);
    const p = huntProgram({ name: 'Test', scenarios: [a, b], isHunt: true }, '16x9');
    expect(p.segments.map((s) => s.kind)).toEqual(['intro', 'title', 'drive', 'title', 'drive', 'end']);
    expect(huntFrameAt(p, INTRO_SECONDS + TITLE_SECONDS + 1)).toMatchObject({ phase: 'drive', scenario: 0 });
    expect(huntFrameAt(p, p.segments[3].start + 1)).toMatchObject({ phase: 'title', scenario: 1 });
  });
});
