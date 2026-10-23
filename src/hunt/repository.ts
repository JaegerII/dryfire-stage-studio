/**
 * Driven-hunt scenarios: a built-in demo plus the ones saved in this browser (localStorage).
 */
import { newId } from '../utils/random';
import { crossingWindow } from './rules';
import { type Crossing, type HuntScenario, SCHEMA_HUNT } from './types';

const KEY = 'dryfire-stage-studio.hunts.v1';

export const DEFAULT_RELEASE: HuntScenario['release'] = { keiler: false, bache: true, ueberlaeufer: true, frischling: true, gallop: true, maxDistance: 60 };

export const newCrossing = (at: number, over: Partial<Crossing> = {}): Crossing => ({
  id: newId('x'),
  at,
  animals: ['ueberlaeufer'],
  gait: 'trot',
  speed: 3.6,
  distance: 35,
  direction: 'ltr',
  seed: Math.floor(Math.random() * 1e6),
  ...over,
});

const DEMO: HuntScenario = {
  schema: SCHEMA_HUNT,
  id: 'hunt_demo_buche',
  name: 'Drückjagd 1 · Buchenschneise',
  lane: 'buche_herbst',
  release: DEFAULT_RELEASE,
  revealSeconds: 6,
  crossings: [
    { id: 'x_demo1', at: 4, animals: ['ueberlaeufer'], gait: 'trot', speed: 3.6, distance: 32, direction: 'ltr', seed: 11 },
    { id: 'x_demo2', at: 26, animals: ['bache', 'frischling', 'frischling', 'frischling', 'frischling', 'ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 8, distance: 38, direction: 'rtl', seed: 5 },
    { id: 'x_demo3', at: 44, animals: ['keiler'], gait: 'gallop', speed: 7, distance: 45, direction: 'ltr', seed: 3 },
  ],
};

const read = (): Record<string, HuntScenario> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
const write = (all: Record<string, HuntScenario>) => localStorage.setItem(KEY, JSON.stringify(all));

export const huntRepository = {
  list(): HuntScenario[] {
    const own = Object.values(read()).sort((a, b) => (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? ''));
    return own.some((s) => s.id === DEMO.id) ? own : [...own, structuredClone(DEMO)];
  },
  get(id: string): HuntScenario | undefined {
    return read()[id] ?? (id === DEMO.id ? structuredClone(DEMO) : undefined);
  },
  save(s: HuntScenario): HuntScenario {
    const saved = { ...s, meta: { ...s.meta, updatedAt: new Date().toISOString() } };
    const all = read();
    all[s.id] = saved;
    write(all);
    return saved;
  },
  remove(id: string) {
    const all = read();
    delete all[id];
    write(all);
  },
  isBuiltIn: (id: string) => id === DEMO.id,
};

export const createHunt = (): HuntScenario => ({
  ...structuredClone(DEMO),
  id: newId('hunt'),
  name: 'Neue Drückjagd',
  crossings: [newCrossing(4)],
  meta: {},
});

/** Length of the drive (scene time): until the last crossing has left the frame, plus a short pause. */
export const driveDuration = (s: HuntScenario) => Math.max(8, ...s.crossings.map((c) => crossingWindow(c).run + 2));

/** What the render service / Blender gets. */
export const renderScenario = (s: HuntScenario) => ({
  duration: Math.ceil(driveDuration(s)),
  crossings: s.crossings.map(({ at, animals, gait, speed, distance, direction, seed }) => ({ at, animals, gait, speed, distance, direction, seed })),
});
