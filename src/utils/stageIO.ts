/** Creating, validating, migrating, importing and exporting stage JSON. */
import { ASSETS } from '../assets/registry';
import { ENVIRONMENTS } from '../assets/environments';
import { SCHEMA_VERSION, type ObjectType, type Stage, type StageObject } from '../types/stage';
import { newId } from './random';

export const createStage = (): Stage => ({
  schemaVersion: SCHEMA_VERSION,
  id: newId('stage'),
  name: 'New Stage',
  environment: 'indoor_01',
  parTime: 5,
  repetitions: 6,
  resetTime: 3,
  standbyDelay: { min: 1, max: 3 },
  objects: [createObject('start_box', 0.5, 0.97)],
  meta: { difficulty: 'beginner', discipline: 'handgun', createdAt: new Date().toISOString() },
});

export const createObject = (type: ObjectType, x: number, y: number): StageObject => ({
  id: newId(ASSETS[type].category),
  type,
  x,
  y,
  scale: 1,
  rotation: 0,
  zIndex: 0,
  ...(ASSETS[type].defaultElevation ? { elevation: ASSETS[type].defaultElevation } : {}),
});

export class StageFormatError extends Error {}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Accepts anything JSON-shaped, returns a valid current-schema stage or throws. */
export const normalizeStage = (raw: unknown): Stage => {
  if (!raw || typeof raw !== 'object') throw new StageFormatError('Not a stage object.');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.objects)) throw new StageFormatError('Stage has no "objects" array.');
  const env = typeof r.environment === 'string' && r.environment in ENVIRONMENTS ? (r.environment as Stage['environment']) : 'indoor_01';
  const sd = (r.standbyDelay ?? {}) as Record<string, unknown>;
  const objects: StageObject[] = [];
  for (const o of r.objects as Record<string, unknown>[]) {
    if (!o || typeof o.type !== 'string' || !(o.type in ASSETS)) continue; // unknown asset types are skipped
    objects.push({
      ...(o as unknown as StageObject),
      id: typeof o.id === 'string' ? o.id : newId('obj'),
      x: num(o.x, 0.5),
      y: num(o.y, 0.7),
      scale: num(o.scale, 1),
      rotation: num(o.rotation, 0),
      zIndex: num(o.zIndex, 0),
      elevation: num(o.elevation, ASSETS[o.type as ObjectType].defaultElevation ?? 0) || undefined,
    });
  }
  return {
    ...(r as unknown as Stage),
    schemaVersion: SCHEMA_VERSION,
    id: typeof r.id === 'string' && r.id ? r.id : newId('stage'),
    name: typeof r.name === 'string' && r.name ? r.name : 'Imported Stage',
    environment: env,
    parTime: Math.max(0.5, num(r.parTime, 5)),
    repetitions: Math.max(1, Math.round(num(r.repetitions, 6))),
    resetTime: Math.max(0, num(r.resetTime, 3)),
    standbyDelay: { min: Math.max(0, num(sd.min, 1)), max: Math.max(num(sd.min, 1), num(sd.max, 3)) },
    objects,
  };
};

export const exportStageFile = (stage: Stage) => {
  const blob = new Blob([JSON.stringify(stage, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stage.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importStageFile = (file: File): Promise<Stage> =>
  file.text().then((text) => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new StageFormatError('File is not valid JSON.');
    }
    return normalizeStage(data);
  });
