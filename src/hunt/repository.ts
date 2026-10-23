/**
 * Driven hunts and their scenarios: a built-in demo hunt (nine scenarios: three maps × three stands)
 * plus what is saved in this browser (localStorage) — the same pattern as matches and stages.
 */
import { newId } from '../utils/random';
import { DEFAULT_MAP, MAPS, MAP_IDS, type MapId, type StandIndex, isMapId } from './maps';
import { crossingWindow } from './rules';
import { type Crossing, type Hunt, type HuntRelease, type HuntScenario, SCHEMA_HUNT } from './types';

const KEY = 'dryfire-stage-studio.hunts.v1';
const KEY_HUNTS = 'dryfire-stage-studio.huntmatches.v1';

export const DEFAULT_RELEASE: HuntRelease = { keiler: false, bache: true, ueberlaeufer: true, frischling: true, gallop: true, maxDistance: 60 };

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

// ---------------------------------------------------------------- built-in demo: 3 maps × 3 stands
const DEMO_CROSSINGS: Omit<Crossing, 'id' | 'seed'>[][] = [
  [
    { at: 4, animals: ['ueberlaeufer'], gait: 'trot', speed: 3.6, distance: 32, direction: 'ltr' },
    { at: 26, animals: ['bache', 'frischling', 'frischling', 'frischling', 'frischling', 'ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 8, distance: 38, direction: 'rtl' },
    { at: 44, animals: ['keiler'], gait: 'gallop', speed: 7, distance: 45, direction: 'ltr' },
  ],
  [
    { at: 5, animals: ['bache', 'frischling', 'frischling', 'frischling'], gait: 'trot', speed: 3.2, distance: 30, direction: 'rtl' },
    { at: 24, animals: ['ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 8.5, distance: 42, direction: 'ltr' },
  ],
  [
    { at: 4, animals: ['bache'], gait: 'trot', speed: 3.4, distance: 36, direction: 'ltr' },
    { at: 22, animals: ['bache', 'frischling_gestreift', 'frischling_gestreift', 'frischling_gestreift', 'frischling_gestreift', 'frischling_gestreift'], gait: 'trot', speed: 2.8, distance: 28, direction: 'rtl' },
    { at: 46, animals: ['frischling', 'frischling'], gait: 'gallop', speed: 7.5, distance: 52, direction: 'ltr' },
  ],
];

const demoScenario = (map: MapId, stand: StandIndex, k: number): HuntScenario => ({
  schema: SCHEMA_HUNT,
  id: `hunt_demo_${map}_${stand + 1}`,
  name: `${MAPS[map].short} · Stand ${stand + 1}`,
  map,
  stand,
  release: DEFAULT_RELEASE,
  revealSeconds: 6,
  crossings: DEMO_CROSSINGS[k % DEMO_CROSSINGS.length].map((c, i) => ({ ...c, id: `x_${map}_${stand}_${i}`, seed: 11 + 7 * k + i })),
});
const DEMO_SCENARIOS: HuntScenario[] = MAP_IDS.flatMap((map, mi) => ([0, 1, 2] as StandIndex[]).map((stand) => demoScenario(map, stand, mi * 3 + stand)));
const DEMO_HUNT: Hunt = {
  schema: SCHEMA_HUNT,
  id: 'hunt_demo',
  name: 'Drückjagd 1 · Drei Reviere',
  description: 'Herbst, Winter und Fichte – je drei Stände.',
  scenarioIds: DEMO_SCENARIOS.map((s) => s.id),
  release: DEFAULT_RELEASE,
};

// ---------------------------------------------------------------- storage
const read = <T>(key: string): Record<string, T> => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
};
const write = (key: string, all: Record<string, unknown>) => localStorage.setItem(key, JSON.stringify(all));

/** Older saves (schema 1: one lane, one stand) → map + stand. */
export const normalizeScenario = (raw: unknown): HuntScenario => {
  const r = (raw ?? {}) as Partial<HuntScenario> & { lane?: string };
  return {
    ...(r as HuntScenario),
    schema: SCHEMA_HUNT,
    id: r.id || newId('hs'),
    name: r.name || 'Szenario',
    map: isMapId(r.map) ? r.map : isMapId(r.lane) ? r.lane : DEFAULT_MAP,
    stand: ([0, 1, 2] as const).includes(r.stand as StandIndex) ? (r.stand as StandIndex) : 0,
    release: { ...DEFAULT_RELEASE, ...r.release },
    crossings: Array.isArray(r.crossings) ? r.crossings : [],
    revealSeconds: typeof r.revealSeconds === 'number' ? r.revealSeconds : 6,
  };
};

export const scenarioRepository = {
  list(): (HuntScenario & { builtIn: boolean })[] {
    const own = Object.values(read<HuntScenario>(KEY))
      .map(normalizeScenario)
      .sort((a, b) => (b.meta?.updatedAt ?? '').localeCompare(a.meta?.updatedAt ?? ''));
    const ids = new Set(own.map((s) => s.id));
    return [...own.map((s) => ({ ...s, builtIn: false })), ...DEMO_SCENARIOS.filter((s) => !ids.has(s.id)).map((s) => ({ ...structuredClone(s), builtIn: true }))];
  },
  get(id: string): HuntScenario | undefined {
    const own = read<HuntScenario>(KEY)[id];
    if (own) return normalizeScenario(own);
    const b = DEMO_SCENARIOS.find((s) => s.id === id);
    return b ? structuredClone(b) : undefined;
  },
  save(s: HuntScenario): HuntScenario {
    const saved = { ...s, meta: { ...s.meta, updatedAt: new Date().toISOString() } };
    const all = read<HuntScenario>(KEY);
    all[s.id] = saved;
    write(KEY, all);
    return saved;
  },
  remove(id: string) {
    const all = read<HuntScenario>(KEY);
    delete all[id];
    write(KEY, all);
  },
  isBuiltIn: (id: string) => DEMO_SCENARIOS.some((s) => s.id === id),
};

export const huntRepository = {
  list(): (Hunt & { builtIn: boolean })[] {
    const own = Object.values(read<Hunt>(KEY_HUNTS)).sort((a, b) => a.name.localeCompare(b.name));
    return [...own.map((h) => ({ ...h, builtIn: false })), ...(own.some((h) => h.id === DEMO_HUNT.id) ? [] : [{ ...structuredClone(DEMO_HUNT), builtIn: true }])];
  },
  get(id: string): Hunt | undefined {
    return read<Hunt>(KEY_HUNTS)[id] ?? (id === DEMO_HUNT.id ? structuredClone(DEMO_HUNT) : undefined);
  },
  save(h: Hunt): Hunt {
    const saved = { ...h, meta: { ...h.meta, updatedAt: new Date().toISOString() } };
    const all = read<Hunt>(KEY_HUNTS);
    all[h.id] = saved;
    write(KEY_HUNTS, all);
    return saved;
  },
  remove(id: string) {
    const all = read<Hunt>(KEY_HUNTS);
    delete all[id];
    write(KEY_HUNTS, all);
  },
  isBuiltIn: (id: string) => id === DEMO_HUNT.id,
};

export const createScenario = (map: MapId = DEFAULT_MAP, stand: StandIndex = 0): HuntScenario => ({
  schema: SCHEMA_HUNT,
  id: newId('hs'),
  name: `${MAPS[map].short} · Stand ${stand + 1}`,
  map,
  stand,
  release: DEFAULT_RELEASE,
  revealSeconds: 6,
  crossings: [newCrossing(4)],
  meta: {},
});

export const createHunt = (): Hunt => ({ schema: SCHEMA_HUNT, id: newId('hunt'), name: 'Neue Drückjagd', scenarioIds: [], release: DEFAULT_RELEASE });

/** The hunt's scenarios that exist, in play order. */
export const huntScenarios = (h: Hunt) => h.scenarioIds.map((id) => scenarioRepository.get(id)).filter((s): s is HuntScenario => !!s);

/** Length of a drive (scene time): until the last crossing has left the frame, plus a short pause. */
export const driveDuration = (s: Pick<HuntScenario, 'crossings'>) => Math.max(8, ...s.crossings.map((c) => crossingWindow(c).run + 2));

/** What the render service / Blender gets. */
export const renderScenario = (s: HuntScenario) => ({
  map: s.map,
  stand: s.stand,
  duration: Math.ceil(driveDuration(s)),
  crossings: s.crossings.map(({ at, animals, gait, speed, distance, direction, seed }) => ({ at, animals, gait, speed, distance, direction, seed })),
});
