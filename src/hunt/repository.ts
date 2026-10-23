/**
 * Driven hunts and their scenarios: built-in demo hunts (nine scenarios each: three maps × three stands)
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

// ---------------------------------------------------------------- built-in demos: each map × 3 stands
type DemoCrossing = Omit<Crossing, 'id' | 'seed'>;
const F = 'frischling';
const FG = 'frischling_gestreift';
/** Crossing patterns the demo scenarios cycle through: single animals, sounders, near and far, both ways. */
const DEMO_CROSSINGS: DemoCrossing[][] = [
  [
    { at: 4, animals: ['ueberlaeufer'], gait: 'trot', speed: 3.6, distance: 32, direction: 'ltr' },
    { at: 26, animals: ['bache', F, F, F, F, 'ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 8, distance: 38, direction: 'rtl' },
    { at: 44, animals: ['keiler'], gait: 'gallop', speed: 7, distance: 45, direction: 'ltr' },
  ],
  [
    { at: 5, animals: ['bache', F, F, F], gait: 'trot', speed: 3.2, distance: 30, direction: 'rtl' },
    { at: 24, animals: ['ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 8.5, distance: 42, direction: 'ltr' },
  ],
  [
    { at: 4, animals: ['bache'], gait: 'trot', speed: 3.4, distance: 36, direction: 'ltr' },
    { at: 22, animals: ['bache', FG, FG, FG, FG, FG], gait: 'trot', speed: 2.8, distance: 28, direction: 'rtl' },
    { at: 46, animals: [F, F], gait: 'gallop', speed: 7.5, distance: 52, direction: 'ltr' },
  ],
  [
    { at: 3, animals: ['keiler'], gait: 'trot', speed: 2.6, distance: 24, direction: 'rtl' },
    { at: 18, animals: ['ueberlaeufer', 'ueberlaeufer', 'ueberlaeufer'], gait: 'gallop', speed: 9, distance: 34, direction: 'ltr' },
    { at: 36, animals: ['bache', 'bache', F, F, F, F, F, F], gait: 'gallop', speed: 7.5, distance: 40, direction: 'rtl' },
  ],
  [
    { at: 4, animals: [F, F, F], gait: 'gallop', speed: 8, distance: 26, direction: 'ltr' },
    { at: 20, animals: ['bache', 'ueberlaeufer', F, F], gait: 'trot', speed: 3.8, distance: 55, direction: 'ltr' },
    { at: 42, animals: ['keiler'], gait: 'gallop', speed: 9.5, distance: 32, direction: 'rtl' },
  ],
  [
    { at: 5, animals: ['ueberlaeufer'], gait: 'gallop', speed: 10, distance: 46, direction: 'rtl' },
    { at: 21, animals: ['bache', FG, FG, FG, FG], gait: 'trot', speed: 3, distance: 33, direction: 'ltr' },
    { at: 40, animals: ['ueberlaeufer', 'ueberlaeufer'], gait: 'trot', speed: 4.2, distance: 22, direction: 'rtl' },
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
const demoHunt = (id: string, name: string, description: string, maps: MapId[]): Hunt => ({
  schema: SCHEMA_HUNT,
  id,
  name,
  description,
  scenarioIds: DEMO_SCENARIOS.filter((s) => maps.includes(s.map)).map((s) => s.id),
  release: DEFAULT_RELEASE,
});
const DEMO_HUNTS: Hunt[] = [
  demoHunt('hunt_demo', 'Drückjagd 1 · Drei Reviere', 'Herbst, Winter und Fichte – je drei Stände.', ['buche_herbst', 'buche_winter', 'fichte']),
  demoHunt('hunt_demo_2', 'Drückjagd 2 · Hang, Kiefer, Stangenholz', 'Buchenhang im Schnee, Kiefern mit Adlerfarn, Stangenholz im Raureif – je drei Stände.', [
    'buche_hang_schnee',
    'kiefer_farn',
    'stangenholz_raureif',
  ]),
];

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
    const ids = new Set(own.map((h) => h.id));
    return [...own.map((h) => ({ ...h, builtIn: false })), ...DEMO_HUNTS.filter((h) => !ids.has(h.id)).map((h) => ({ ...structuredClone(h), builtIn: true }))];
  },
  get(id: string): Hunt | undefined {
    const own = read<Hunt>(KEY_HUNTS)[id];
    if (own) return own;
    const b = DEMO_HUNTS.find((h) => h.id === id);
    return b ? structuredClone(b) : undefined;
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
  isBuiltIn: (id: string) => DEMO_HUNTS.some((h) => h.id === id),
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
