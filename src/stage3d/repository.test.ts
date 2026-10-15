import { describe, expect, it } from 'vitest';
import type { Match } from '../types/match';
import { fromLegacyStage, normalizeLegacyStage } from './legacy';
import { migrateLegacyStages, normalizeStage3D, readStageJson, stage3dRepository } from './repository';
import { ENV3D, parTime3D } from './types';

describe('normalizeStage3D', () => {
  it('fills defaults, keeps one leg per position change and drops unknown objects', () => {
    const s = normalizeStage3D({
      name: 'X',
      positions: [{ x: 1, d: 0 }, { x: 3, d: 4 }, { x: 5, d: 6 }],
      legs: [{ after: 2, duration: 1, reload: true }],
      objects: [{ type: 'paper_full', x: 1, d: 9 }, { type: 'spaceship', x: 0, d: 0 }],
    });
    expect(s.positions.map((p) => p.label)).toEqual(['START', 'P2', 'P3']);
    expect(s.legs).toHaveLength(2);
    expect(s.legs[0]).toMatchObject({ after: 2, duration: 1, reload: true });
    expect(s.legs[1]).toMatchObject({ after: 3, duration: 2.5, reload: false });
    expect(s.objects.map((o) => o.type)).toEqual(['paper_full']);
    expect(parTime3D(s)).toBe(2 + 1 + 3 + 2.5 + 5);
  });

  it('always has a start position', () => {
    expect(normalizeStage3D({}).positions).toHaveLength(1);
  });
});

describe('built-in stages', () => {
  it('every stage of every built-in match exists', () => {
    const matches = Object.values(import.meta.glob<Match>('../data/matches/*.json', { eager: true, import: 'default' }));
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) for (const id of m.stageIds) expect(stage3dRepository.get(id), `${m.id} → ${id}`).toBeDefined();
  });
});

/** An old 2.5D stage as the studio saved it (plate coordinates). */
const legacy = {
  id: 'stage_x',
  name: 'Old stage',
  environment: 'outdoor_03',
  parTime: 6,
  repetitions: 4,
  resetTime: 3,
  standbyDelay: { min: 1, max: 2 },
  objects: [
    { id: 'start', type: 'start_box', x: 0.5, y: 0.97, scale: 1, rotation: 0, zIndex: 0 },
    { id: 't1', type: 'paper_full', x: 0.4, y: 0.6, scale: 1, rotation: 0, zIndex: 0, yaw: 20 },
    { id: 'p1', type: 'steel_popper', x: 0.6, y: 0.55, scale: 1, rotation: 0, zIndex: 0, motion: { kind: 'fall', delay: 1 } },
  ],
};

describe('old 2.5D stages', () => {
  it('become 3D stages 1:1: same id, own outdoor range, objects downrange of the start', () => {
    const s = readStageJson(legacy);
    expect(s.id).toBe('stage_x');
    expect(s.environment).toBe('outdoor_03');
    expect(s.positions).toHaveLength(1);
    expect(parTime3D(s)).toBe(6);
    expect(s.objects.map((o) => o.id)).toEqual(['t1', 'p1']);
    const room = ENV3D.outdoor_03;
    for (const o of s.objects) {
      expect(o.d).toBeGreaterThan(s.positions[0].d + 3);
      expect(o.x).toBeGreaterThanOrEqual(room.x0);
      expect(o.x).toBeLessThanOrEqual(room.x1);
    }
    // 2D yaw turns the right side away = counter-clockwise from above
    expect(s.objects[0].yaw).toBe(-20);
    expect(s.objects[1].motion).toEqual({ kind: 'fall', delay: 1 });
  });

  it('dynamic stages: every area a position, the wipe a move with reload, each area up only while it is shot', () => {
    const s = fromLegacyStage(
      normalizeLegacyStage({
        ...legacy,
        areaTime: 3,
        transition: { duration: 2, direction: 'ltr', style: 'mesh' },
        areas: [{ environment: 'outdoor_03', time: 4, objects: [{ id: 'a2', type: 'steel_popper', x: 0.5, y: 0.6, motion: { kind: 'fall', delay: 1 } }] }],
      }),
    );
    expect(s.positions).toHaveLength(2);
    expect(s.positions[1].x).toBeGreaterThan(s.positions[0].x);
    expect(s.legs).toEqual([{ after: 3, duration: 2, reload: true }]);
    expect(parTime3D(s)).toBe(3 + 2 + 4);
    const t1 = s.objects.find((o) => o.id === 't1')!;
    const a2 = s.objects.find((o) => o.id === 'a2')!;
    expect(t1.shown).toEqual({ until: 4 });
    expect(a2.shown).toEqual({ from: 4 });
    // the area's own clock started after the move: its popper falls 1 s into it
    expect(a2.motion).toEqual({ kind: 'fall', delay: 6 });
  });
});

/** In-memory localStorage. */
const memoryStorage = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
};

describe('migrateLegacyStages', () => {
  it('converts the old stages, renames the beta copies and runs only once', () => {
    const at = (day: number) => ({ updatedAt: `2026-10-0${day}T12:00:00.000Z` });
    const beta = (id: string, day: number) => normalizeStage3D({ id, name: 'Edited in the 3D beta', meta: at(day) });
    const old = (id: string, day: number) => ({ ...legacy, id, name: 'Old edit', meta: at(day) });
    const storage = memoryStorage({
      'dryfire-stage-studio.stages.v1': JSON.stringify({ stage_x: legacy, stage_001: old('stage_001', 1), stage_002: old('stage_002', 5) }),
      'dryfire-stage-studio.stages3d.v1': JSON.stringify({ stage_001_3d: beta('stage_001_3d', 3), stage_002_3d: beta('stage_002_3d', 3) }),
    });
    migrateLegacyStages(storage);
    const all = JSON.parse(storage.getItem('dryfire-stage-studio.stages3d.v1')!);
    expect(Object.keys(all).sort()).toEqual(['stage_001', 'stage_002', 'stage_x']);
    // edited in both: the more recent edit is kept
    expect(all.stage_001.name).toBe('Edited in the 3D beta');
    expect(all.stage_002.name).toBe('Old edit');
    expect(all.stage_x.environment).toBe('outdoor_03');
    // the old data stays as a backup; a second run changes nothing
    expect(storage.getItem('dryfire-stage-studio.stages.v1')).toContain('stage_x');
    storage.setItem('dryfire-stage-studio.stages.v1', JSON.stringify({ stage_y: { ...legacy, id: 'stage_y' } }));
    migrateLegacyStages(storage);
    expect(Object.keys(JSON.parse(storage.getItem('dryfire-stage-studio.stages3d.v1')!))).not.toContain('stage_y');
  });
});
