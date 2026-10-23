import { describe as group, expect, it } from 'vitest';
import { crossingWindow, describe, judge, leadCm, sounderOrder } from './rules';
import type { Crossing, HuntRelease } from './types';

const release: HuntRelease = { keiler: false, bache: true, ueberlaeufer: true, frischling: true, gallop: true, maxDistance: 60 };
const crossing = (over: Partial<Crossing>): Crossing => ({ id: 'c', at: 10, animals: ['ueberlaeufer'], gait: 'trot', speed: 3.6, distance: 35, direction: 'ltr', seed: 1, ...over });

group('driven hunt release', () => {
  it('never releases a sow leading piglets', () => {
    const v = judge(crossing({ animals: ['frischling', 'bache', 'frischling', 'ueberlaeufer'] }), release);
    expect(v[0]).toMatchObject({ kind: 'bache', free: false, lead: true });
    expect(v.filter((a) => a.free).map((a) => a.kind)).toEqual(['frischling', 'frischling', 'ueberlaeufer']);
  });

  it('releases a single sow without young only if sows are released', () => {
    expect(judge(crossing({ animals: ['bache'] }), release)[0].free).toBe(true);
    expect(judge(crossing({ animals: ['bache'] }), { ...release, bache: false })[0].free).toBe(false);
  });

  it('applies distance and fleeing-game limits before the class', () => {
    expect(judge(crossing({ distance: 70 }), release)[0].reason).toMatch(/zu weit/);
    expect(judge(crossing({ gait: 'gallop' }), { ...release, gallop: false })[0].reason).toMatch(/flüchtig/);
    expect(judge(crossing({ animals: ['keiler'] }), release)[0].free).toBe(false);
  });

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
