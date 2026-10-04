/**
 * Stage storage behind one interface. Today: built-in JSON files plus the
 * browser's localStorage. Later: a server implementation (accounts, public
 * library, premium packs) can replace LocalStageRepository without touching
 * the editor or player.
 */
import type { Stage } from '../types/stage';
import { normalizeStage } from '../utils/stageIO';

export interface StageSummary {
  id: string;
  name: string;
  environment: Stage['environment'];
  parTime: number;
  repetitions: number;
  builtIn: boolean;
  /** A locally saved copy that shadows a built-in stage. */
  overridesBuiltIn: boolean;
  updatedAt?: string;
}

export interface StageRepository {
  list(): StageSummary[];
  get(id: string): Stage | undefined;
  save(stage: Stage): Stage;
  remove(id: string): void;
  isBuiltIn(id: string): boolean;
}

const BUILT_IN: Stage[] = Object.values(
  import.meta.glob<Stage>('./stages/*.json', { eager: true, import: 'default' }),
).map(normalizeStage);

const KEY = 'dryfire-stage-studio.stages.v1';

const summary = (s: Stage, builtIn: boolean, overridesBuiltIn = false): StageSummary => ({
  id: s.id,
  name: s.name,
  environment: s.environment,
  parTime: s.parTime,
  repetitions: s.repetitions,
  builtIn,
  overridesBuiltIn,
  updatedAt: s.meta?.updatedAt,
});

export class LocalStageRepository implements StageRepository {
  private read(): Record<string, Stage> {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  private write(all: Record<string, Stage>) {
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  list() {
    const local = this.read();
    const builtIn = BUILT_IN.filter((s) => !local[s.id]).map((s) => summary(s, true));
    const own = Object.values(local)
      .map((s) => summary(s, false, this.isBuiltIn(s.id)))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return [...own, ...builtIn];
  }

  get(id: string) {
    const local = this.read()[id];
    if (local) return normalizeStage(local);
    const b = BUILT_IN.find((s) => s.id === id);
    return b ? structuredClone(b) : undefined;
  }

  save(stage: Stage) {
    const saved: Stage = { ...stage, meta: { ...stage.meta, updatedAt: new Date().toISOString() } };
    const all = this.read();
    all[stage.id] = saved;
    this.write(all);
    return saved;
  }

  remove(id: string) {
    const all = this.read();
    delete all[id];
    this.write(all);
  }

  isBuiltIn(id: string) {
    return BUILT_IN.some((s) => s.id === id);
  }
}

export const stageRepository: StageRepository = new LocalStageRepository();
