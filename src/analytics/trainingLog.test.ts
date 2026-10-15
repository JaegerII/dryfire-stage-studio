import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYZER, type RepResult } from '../motion/analyzer';
import { TrainingLog, type TrainingSession, summarize } from './trainingLog';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const rep = (n: number, total?: number, early = false): RepResult => ({
  rep: n,
  signalT: 0,
  status: total ? 'complete' : 'no_movement',
  earlyMovement: early,
  events: [],
  metrics: total ? { total: { ms: total, uncertaintyMs: 10, confidence: 0.9 } } : {},
  framesUsed: 100,
  framesSkipped: 0,
  usedDepth: true,
});

const session = (id: string, createdAt: string): TrainingSession => ({
  id,
  createdAt,
  stageId: 's',
  stageName: 'S',
  parTime: 3,
  reps: [rep(1, 1000)],
  analyzerVersion: 1,
  config: DEFAULT_ANALYZER,
  timing: { signalSource: 'phone', signalUncertaintyMs: 5, frameTimeSource: 'capture', medianFrameIntervalMs: 16.7, fps: 60 },
  camera: { label: 'cam', width: 1280, height: 720 },
  model: 'lite',
});

describe('TrainingLog', () => {
  it('saves, lists newest first and removes', () => {
    const log = new TrainingLog(memory());
    log.save(session('a', '2026-01-01T00:00:00Z'));
    log.save(session('b', '2026-02-01T00:00:00Z'));
    expect(log.list().map((s) => s.id)).toEqual(['b', 'a']);
    log.remove('b');
    expect(log.list().map((s) => s.id)).toEqual(['a']);
    log.clear();
    expect(log.list()).toEqual([]);
  });

  it('survives corrupt storage', () => {
    const m = memory();
    m.setItem('forth-trace.sessions.v1', '{oops');
    expect(new TrainingLog(m).list()).toEqual([]);
  });
});

describe('summarize', () => {
  it('only aggregates measured reps and excludes early movement', () => {
    const s = summarize([rep(1, 1000), rep(2, 1200), rep(3), rep(4, 500, true), rep(5, 1100)], 'total');
    expect(s.n).toBe(3);
    expect(s.of).toBe(5);
    expect(s.best).toBe(1000);
    expect(s.median).toBe(1100);
    expect(s.mean).toBeCloseTo(1100, 6);
    expect(s.sd).toBeCloseTo(100, 6);
  });

  it('reports nothing instead of zero when there is no value', () => {
    expect(summarize([rep(1)], 'total')).toEqual({ n: 0, of: 1 });
  });
});
