/**
 * Stages: built-in JSON files (src/stage3d/stages) plus the ones saved in this
 * browser (localStorage). Saving a built-in stage keeps your version under the same id.
 */
import { ASSETS } from '../assets/registry';
import { newId } from '../utils/random';
import { fromLegacyStage, isLegacyStage, normalizeLegacyStage } from './legacy';
import { type Leg, SCHEMA_3D, type ShooterPosition, type Stage3D, type StageObject3D, isEnv3D, parTime3D } from './types';

const RAW_BUILT_IN = Object.values(import.meta.glob<Stage3D>('./stages/*.json', { eager: true, import: 'default' }));
// normalised on first use (normalizeStage3D is defined further down)
let builtIn: Stage3D[] | null = null;
const BUILT_IN = () => (builtIn ??= RAW_BUILT_IN.map((s) => normalizeStage3D(s)).sort((a, b) => a.id.localeCompare(b.id)));
const KEY = 'dryfire-stage-studio.stages3d.v1';

export interface Stage3DSummary {
  id: string;
  name: string;
  environment: Stage3D['environment'];
  repetitions: number;
  par: number;
  positions: number;
  objects: number;
  builtIn: boolean;
  overridesBuiltIn: boolean;
  updatedAt?: string;
  /** Id of the 2D stage it was made from. */
  source?: string;
}

const read = (): Record<string, Stage3D> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
const write = (all: Record<string, Stage3D>) => localStorage.setItem(KEY, JSON.stringify(all));

const summary = (s: Stage3D, builtIn: boolean, overrides = false): Stage3DSummary => ({
  id: s.id,
  name: s.name,
  environment: s.environment,
  repetitions: s.repetitions,
  par: parTime3D(s),
  positions: s.positions.length,
  objects: s.objects.length,
  builtIn,
  overridesBuiltIn: overrides,
  updatedAt: s.meta?.updatedAt,
  source: s.meta?.source,
});

export const stage3dRepository = {
  list(): Stage3DSummary[] {
    const local = read();
    const own = Object.values(local)
      .map((s) => summary(s, false, BUILT_IN().some((b) => b.id === s.id)))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return [...own, ...BUILT_IN().filter((s) => !local[s.id]).map((s) => summary(s, true))];
  },
  get(id: string): Stage3D | undefined {
    const local = read()[id];
    if (local) return normalizeStage3D(local);
    const b = BUILT_IN().find((s) => s.id === id);
    return b ? structuredClone(b) : undefined;
  },
  save(s: Stage3D): Stage3D {
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
  isBuiltIn: (id: string) => BUILT_IN().some((s) => s.id === id),
  first: () => BUILT_IN()[0],
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Accepts anything JSON-shaped; returns a valid 3D stage (unknown object types are dropped). */
export function normalizeStage3D(raw: unknown): Stage3D {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const objects: StageObject3D[] = (Array.isArray(r.objects) ? r.objects : [])
    .filter((o: Record<string, unknown>) => o && typeof o.type === 'string' && o.type in ASSETS)
    .map((o: Record<string, unknown>) => ({ ...(o as unknown as StageObject3D), id: typeof o.id === 'string' ? o.id : newId('obj'), x: num(o.x, 0), d: num(o.d, 8) }));
  let positions: ShooterPosition[] = (Array.isArray(r.positions) ? r.positions : []).map((p: Record<string, unknown>, i: number) => ({
    ...(p as unknown as ShooterPosition),
    id: typeof p.id === 'string' ? p.id : newId('pos'),
    x: num(p.x, 0),
    d: num(p.d, 0),
    heading: num(p.heading, 0),
    label: typeof p.label === 'string' ? p.label : i === 0 ? 'START' : `P${i + 1}`,
  }));
  if (!positions.length) positions = [{ id: 'start', label: 'START', x: 0, d: 0, heading: 0 }];
  const rawLegs = Array.isArray(r.legs) ? (r.legs as Record<string, unknown>[]) : [];
  const legs: Leg[] = positions.slice(1).map((_, i) => {
    const l = rawLegs[i] ?? {};
    return {
      after: Math.max(0, num(l.after, 3)),
      duration: Math.max(0.3, num(l.duration, 2.5)),
      reload: !!l.reload,
      ...(Array.isArray(l.via) && l.via.length ? { via: (l.via as { x: number; d: number }[]).map((v) => ({ x: num(v.x, 0), d: num(v.d, 0) })) } : {}),
    };
  });
  const sd = (r.standbyDelay ?? {}) as Record<string, unknown>;
  return {
    schemaVersion: SCHEMA_3D,
    id: typeof r.id === 'string' && r.id ? r.id : newId('stage3d'),
    name: typeof r.name === 'string' && r.name ? r.name : 'New 3D Stage',
    description: typeof r.description === 'string' ? r.description : undefined,
    environment: typeof r.environment === 'string' && isEnv3D(r.environment) ? r.environment : 'indoor_01',
    repetitions: Math.max(1, Math.round(num(r.repetitions, 3))),
    resetTime: Math.max(0, num(r.resetTime, 4)),
    standbyDelay: { min: Math.max(0, num(sd.min, 1)), max: Math.max(num(sd.min, 1), num(sd.max, 2)) },
    objects,
    positions,
    legs,
    finalTime: Math.max(0.5, num(r.finalTime, 5)),
    ...(typeof r.start === 'string' && r.start.trim() ? { start: r.start } : {}),
    ...(r.camera && typeof r.camera === 'object' ? { camera: { shake: num((r.camera as Record<string, unknown>).shake, 1) } } : {}),
    meta: (r.meta as Stage3D['meta']) ?? undefined,
  };
}

export const createStage3D = (): Stage3D => ({
  schemaVersion: SCHEMA_3D,
  id: newId('stage'),
  name: 'New Stage',
  environment: 'indoor_01',
  repetitions: 3,
  resetTime: 4,
  standbyDelay: { min: 1, max: 2 },
  positions: [{ id: newId('pos'), label: 'START', x: 0, d: 0, heading: 0 }],
  legs: [],
  finalTime: 5,
  objects: [
    { id: newId('target'), type: 'paper_full', x: -1.5, d: 8 },
    { id: newId('target'), type: 'paper_full', x: 0, d: 9 },
    { id: newId('target'), type: 'paper_full', x: 1.5, d: 8 },
  ],
  meta: { createdAt: new Date().toISOString() },
});

/** A stage file of either format: a 3D stage, or an old 2.5D stage (converted, same id). */
export const readStageJson = (raw: unknown): Stage3D => (isLegacyStage(raw) ? fromLegacyStage(normalizeLegacyStage(raw)) : normalizeStage3D(raw));

// ------------------------------------------------------------------ one-time move of the old data

/** Where the 2.5D studio kept the stages saved in this browser (left in place as a backup). */
const LEGACY_KEY = 'dryfire-stage-studio.stages.v1';
const MIGRATED_KEY = 'dryfire-stage-studio.migrated-to-3d.v1';
/** Suffix of the 3D copies the 3D beta made of built-in 2.5D stages ("stage_001_3d"). */
const BETA_SUFFIX = '_3d';

/**
 * Everything becomes 3D, keeping the ids (matches and the training log refer to them):
 *  - 3D versions of built-in stages saved by the 3D beta ("stage_001_3d") take the plain id;
 *  - every 2.5D stage saved in this browser (own stages and edited built-ins) is converted;
 *    where a 3D version with that id exists too, the more recently saved one is kept.
 * Runs once per browser; the old 2.5D data stays in localStorage untouched.
 */
export const migrateLegacyStages = (storage: Storage = localStorage) => {
  if (storage.getItem(MIGRATED_KEY)) return;
  const parse = (k: string): Record<string, unknown> => {
    try {
      return JSON.parse(storage.getItem(k) ?? '{}') ?? {};
    } catch {
      return {};
    }
  };
  const all = parse(KEY) as Record<string, Stage3D>;
  for (const [id, s] of Object.entries(all)) {
    if (!id.endsWith(BETA_SUFFIX)) continue;
    const base = id.slice(0, -BETA_SUFFIX.length);
    if (!all[base]) all[base] = { ...s, id: base };
    delete all[id];
  }
  for (const raw of Object.values(parse(LEGACY_KEY))) {
    try {
      const s = fromLegacyStage(normalizeLegacyStage(raw));
      const had = all[s.id];
      if (!had || (s.meta?.updatedAt ?? '') > (had.meta?.updatedAt ?? '')) all[s.id] = { ...s, meta: { ...s.meta, updatedAt: s.meta?.updatedAt ?? new Date().toISOString() } };
    } catch {
      // a broken old entry is skipped (it stays in the backup)
    }
  }
  storage.setItem(KEY, JSON.stringify(all));
  storage.setItem(MIGRATED_KEY, new Date().toISOString());
};
