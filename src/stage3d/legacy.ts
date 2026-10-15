/**
 * Old 2.5D stages (before everything moved to 3D): their format and the conversion
 * into 3D stages. Only used to read old data — stages saved in this browser, exported
 * stage files and match bundles — and to keep the ids, so matches still find them.
 *
 * A 2.5D stage placed its objects on a photo plate (x, y = 0..1 of the image, seen
 * from a level camera at the start); the floor position follows from the plate camera.
 * A dynamic stage had several areas, shown one after the other with a barrier wipe
 * between them (the reload window): in 3D every area becomes a shooting position, the
 * wipe a move with reload, and each area's objects are only up while it is shot.
 */
import { ASSETS } from '../assets/registry';
import type { EnvironmentId, Motion, ObjectType } from '../types/stage';
import { newId } from '../utils/random';
import { SCHEMA_3D, type Leg, type ShooterPosition, type Stage3D, type StageObject3D, env3dFor, roomOf } from './types';

export interface LegacyObject {
  id: string;
  type: ObjectType;
  /** Floor contact point, 0..1 of the plate width / height. */
  x: number;
  y: number;
  scale: number;
  elevation?: number;
  flip?: boolean;
  /** Turn away from the shooter (degrees). */
  yaw?: number;
  group?: string;
  motion?: Motion;
}

export interface LegacyArea {
  environment: EnvironmentId;
  objects: LegacyObject[];
  /** Seconds this area is shot. */
  time: number;
}

export interface LegacyStage {
  id: string;
  name: string;
  description?: string;
  environment: EnvironmentId;
  parTime: number;
  repetitions: number;
  resetTime: number;
  standbyDelay: { min: number; max: number };
  objects: LegacyObject[];
  /** Dynamic stage: areas after area 1, and how long area 1 is shot. */
  areas?: LegacyArea[];
  areaTime?: number;
  transition?: { duration: number; direction: 'ltr' | 'rtl' };
  meta?: { createdAt?: string; updatedAt?: string };
}

const ENV_IDS: EnvironmentId[] = ['indoor_01', 'indoor_02', 'indoor_03', 'indoor_04', 'indoor_05', 'indoor_06', 'outdoor_01', 'outdoor_02', 'outdoor_03', 'outdoor_04', 'outdoor_05'];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const envOf = (v: unknown, d: EnvironmentId): EnvironmentId => (typeof v === 'string' && (ENV_IDS as string[]).includes(v) ? (v as EnvironmentId) : d);

/** A 2.5D stage has plate coordinates (x, y) on its objects and no shooter positions. */
export const isLegacyStage = (raw: unknown): boolean => {
  const r = raw as Record<string, unknown> | null;
  return !!r && typeof r === 'object' && Array.isArray(r.objects) && !Array.isArray(r.positions);
};

const legacyObjects = (raw: unknown): LegacyObject[] =>
  (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [])
    .filter((o) => o && typeof o.type === 'string' && o.type in ASSETS)
    .map((o) => ({
      ...(o as unknown as LegacyObject),
      id: typeof o.id === 'string' ? o.id : newId('obj'),
      x: num(o.x, 0.5),
      y: num(o.y, 0.7),
      scale: num(o.scale, 1),
    }));

/** Anything JSON-shaped from the old format → a valid LegacyStage. */
export const normalizeLegacyStage = (raw: unknown): LegacyStage => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const env = envOf(r.environment, 'indoor_01');
  const sd = (r.standbyDelay ?? {}) as Record<string, unknown>;
  const areas = (Array.isArray(r.areas) ? (r.areas as Record<string, unknown>[]) : [])
    .filter((a) => a && typeof a === 'object' && Array.isArray(a.objects))
    .map((a) => ({ environment: envOf(a.environment, env), objects: legacyObjects(a.objects), time: Math.max(0.5, num(a.time, 4)) }));
  const tr = (r.transition ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId('stage'),
    name: typeof r.name === 'string' && r.name ? r.name : 'Imported Stage',
    description: typeof r.description === 'string' ? r.description : undefined,
    environment: env,
    parTime: Math.max(0.5, num(r.parTime, 5)),
    repetitions: Math.max(1, Math.round(num(r.repetitions, 6))),
    resetTime: Math.max(0, num(r.resetTime, 3)),
    standbyDelay: { min: Math.max(0, num(sd.min, 1)), max: Math.max(num(sd.min, 1), num(sd.max, 3)) },
    objects: legacyObjects(r.objects),
    ...(areas.length
      ? { areas, areaTime: Math.max(0.5, num(r.areaTime, 4)), transition: { duration: Math.max(0.3, num(tr.duration, 2.5)), direction: tr.direction === 'rtl' ? 'rtl' : 'ltr' } }
      : {}),
    meta: (r.meta as LegacyStage['meta']) ?? undefined,
  };
};

// The plates were rendered by a level camera 1.5 m high, horizon at 40 % of the image,
// focal length 1.4 image heights (tools/plate-renderer), standing 2.2 m in front of d = 0.
const HORIZON = 0.4;
const CAMERA_HEIGHT = 1.5;
const FOCAL = 1.4;
const ASPECT = 16 / 9;
const PLATE_CAMERA_D = -2.2;

/** Floor point on the plate → meters across (X) and distance from the plate camera (D). */
export const plateToWorld = (x: number, y: number) => {
  const D = (FOCAL * CAMERA_HEIGHT) / Math.max(0.002, y - HORIZON);
  return { X: ((x - 0.5) * ASPECT * D) / FOCAL, D };
};

/** Sideways step between the shooting positions of a dynamic stage's areas (m). */
const AREA_STEP = 1.5;

/**
 * A 2.5D stage as a 3D stage, 1:1: same id (matches keep working), same environment,
 * every object at the floor position its plate position implies, same turn, height,
 * size, mirroring, groups and motion; the start box becomes the start position.
 */
export const fromLegacyStage = (s: LegacyStage): Stage3D => {
  const env = env3dFor(s.environment);
  const room = roomOf(env);
  const clampX = (x: number) => Math.max(room.x0 + 0.4, Math.min(room.x1 - 0.4, x));
  const clampD = (d: number) => Math.min(room.d1 - Math.max(0.6, room.backstop), d);
  const start = s.objects.find((o) => o.type === 'start_box');
  const sw = start ? plateToWorld(start.x, start.y) : { X: 0, D: 1.5 };
  const startPos: ShooterPosition = {
    id: `${s.id}_start`,
    label: 'START',
    x: +clampX(sw.X).toFixed(2),
    d: +Math.max(room.d0 + 0.6, sw.D + PLATE_CAMERA_D).toFixed(2),
    heading: 0,
  };

  // areas: [objects, seconds shot]; a static stage is one area for the whole par time
  const areas = [{ objects: s.objects, time: s.areas?.length ? (s.areaTime ?? 4) : s.parTime }, ...(s.areas ?? []).map((a) => ({ objects: a.objects, time: a.time }))];
  const dir = s.transition?.direction === 'rtl' ? -1 : 1;
  const move = s.transition?.duration ?? 2.5;
  const positions: ShooterPosition[] = [startPos];
  const legs: Leg[] = [];
  const objects: StageObject3D[] = [];
  // seconds after the start beep at which the view switches to area k (middle of the move into it)
  const switchAt: number[] = [0];
  // … and at which its own clock starts (the 2.5D player ran each area's motion on that clock)
  const areaStart: number[] = [0];
  for (let k = 1, clock = 0; k < areas.length; k++) {
    clock += areas[k - 1].time;
    switchAt[k] = +(clock + move / 2).toFixed(2);
    clock += move;
    areaStart[k] = +clock.toFixed(2);
  }
  const shift = (m: Motion, k: number): Motion => (k > 0 && !m.trigger ? { ...m, delay: +((m.delay ?? (m.kind === 'fall' ? 1 : 0)) + areaStart[k]).toFixed(2) } : structuredClone(m));
  areas.forEach((area, k) => {
    const dx = k * AREA_STEP * dir;
    if (k > 0) {
      positions.push({ id: `${s.id}_p${k + 1}`, label: `P${k + 1}`, x: +clampX(startPos.x + dx).toFixed(2), d: startPos.d, heading: 0 });
      legs.push({ after: areas[k - 1].time, duration: move, reload: true });
    }
    for (const o of area.objects) {
      if (o.type === 'start_box') continue;
      const w = plateToWorld(o.x, o.y);
      const shown = areas.length > 1 ? { ...(k > 0 ? { from: switchAt[k] } : {}), ...(k < areas.length - 1 ? { until: switchAt[k + 1] } : {}) } : null;
      objects.push({
        id: k > 0 && objects.some((p) => p.id === o.id) ? `${o.id}_a${k + 1}` : o.id,
        type: o.type,
        x: +clampX(w.X + dx).toFixed(2),
        d: +clampD(w.D + PLATE_CAMERA_D).toFixed(2),
        // 2D yaw turns the right side away from the shooter = counter-clockwise from above
        ...(o.yaw ? { yaw: -o.yaw } : {}),
        ...(o.elevation ? { elevation: o.elevation } : {}),
        ...(o.scale !== 1 ? { scale: o.scale } : {}),
        ...(o.flip ? { flip: true } : {}),
        ...(o.group ? { group: k > 0 ? `${o.group}_a${k + 1}` : o.group } : {}),
        ...(o.motion && o.motion.kind !== 'static' ? { motion: shift(o.motion, k) } : {}),
        ...(shown ? { shown } : {}),
      });
    }
  });
  return {
    schemaVersion: SCHEMA_3D,
    id: s.id,
    name: s.name,
    description: s.description,
    environment: env,
    repetitions: s.repetitions,
    resetTime: s.resetTime,
    standbyDelay: { ...s.standbyDelay },
    positions,
    legs,
    finalTime: areas[areas.length - 1].time,
    objects,
    meta: { ...(s.meta?.createdAt ? { createdAt: s.meta.createdAt } : {}), ...(s.meta?.updatedAt ? { updatedAt: s.meta.updatedAt } : {}) },
  };
};
